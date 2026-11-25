import { ApiFootballError, ApiMeta, apiGet, parseFixture, parseStatistics } from "./apiFootball";
import { fetchEspnDayEvents, fetchEspnSummary, getEspnMatchDays } from "./espn";
import { leagueById } from "./leagues";
import { FINISHED, loadConfig, loadStore, saveStore } from "./store";

export interface SyncState {
  running: boolean;
  phase: "idle" | "lists" | "stats" | "done" | "error";
  message: string;
  done: number;
  total: number;
  startedAt?: number;
  finishedAt?: number;
  dailyRemaining?: number;
  error?: string;
}

type G = typeof globalThis & { __fbSync?: SyncState };
const g = globalThis as G;

export function getSyncState(): SyncState {
  if (!g.__fbSync) {
    g.__fbSync = { running: false, phase: "idle", message: "Henüz senkronize edilmedi.", done: 0, total: 0 };
  }
  return g.__fbSync;
}

const RETRY_UNAVAILABLE_MS = 2 * 24 * 3600 * 1000;

export function startSync(mode: "full" | "lists" = "full"): SyncState {
  const state = getSyncState();
  if (state.running) return state;
  const cfg = loadConfig();

  if (cfg.source === "apifootball" && !cfg.apiKey) {
    Object.assign(state, {
      phase: "error",
      running: false,
      error: "API-Football anahtarı girilmemiş.",
      message: "API anahtarı gerekli.",
    });
    return state;
  }

  Object.assign(state, {
    running: true,
    phase: "lists",
    message: "Maç takvimleri alınıyor...",
    done: 0,
    total: cfg.leagues.length,
    startedAt: Date.now(),
    finishedAt: undefined,
    error: undefined,
    dailyRemaining: undefined,
  });

  if (cfg.source === "espn") {
    void runEspnSync(cfg.leagues, mode, state);
  } else {
    void runApiFootballSync(cfg.apiKey!, cfg.leagues, mode, state);
  }
  return state;
}

async function runPool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>) {
  let idx = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      await fn(items[i]);
    }
  });
  await Promise.all(workers);
}

async function runEspnSync(leagues: number[], mode: "full" | "lists", state: SyncState) {
  const store = loadStore();
  try {
    // 1) Tüm seçili liglerin sezon maç günlerini topla
    const tasks: Array<{ leagueId: number; day: string }> = [];
    for (const leagueId of leagues) {
      const lg = leagueById(leagueId);
      if (!lg) continue;
      state.message = `${lg.name} takvimi okunuyor...`;
      try {
        const days = await getEspnMatchDays(lg, store.season);
        for (const day of days) tasks.push({ leagueId, day });
      } catch {
        // tek lig hatası diğerlerini durdurmasın
      }
    }

    // Daha önce çekilmiş eski günleri atla (son 3 gün ve gelecek günler hariç)
    const threeDaysAgo = Date.now() - 3 * 86400000;
    const existingDayKeys = new Set<string>();
    for (const fx of Object.values(store.fixtures)) {
      if (fx.ts < threeDaysAgo && FINISHED.has(fx.status)) {
        const d = fx.date.slice(0, 10).replace(/-/g, "");
        existingDayKeys.add(`${fx.leagueId}:${d}`);
      }
    }

    const toFetch = tasks.filter((t) => !existingDayKeys.has(`${t.leagueId}:${t.day}`));
    Object.assign(state, {
      phase: "lists",
      done: 0,
      total: toFetch.length,
      message: `${toFetch.length} maç günü indiriliyor...`,
    });

    let sinceSave = 0;
    await runPool(toFetch, 8, async (task) => {
      const lg = leagueById(task.leagueId)!;
      try {
        const list = await fetchEspnDayEvents(lg, task.day, store.season);
        for (const fx of list) {
          const prev = store.fixtures[fx.id];
          store.fixtures[fx.id] = prev
            ? {
                ...fx,
                ht: prev.ht.home !== null ? prev.ht : fx.ht,
                referee: prev.referee ?? fx.referee,
                stats: prev.detailFetched ? prev.stats : fx.stats ?? prev.stats,
                detailFetched: prev.detailFetched,
              }
            : fx;
        }
      } catch {
        // boş/hatalı günü atla
      }
      state.done++;
      state.message = `Maçlar ve temel istatistikler: ${state.done}/${state.total} gün`;
      if (++sinceSave >= 25) {
        saveStore(store);
        sinceSave = 0;
      }
    });

    store.lastListSync = new Date().toISOString();
    saveStore(store);

    if (mode === "lists") {
      Object.assign(state, { running: false, phase: "done", message: "Fikstürler güncellendi.", finishedAt: Date.now() });
      return;
    }

    // 2) Bitmiş maçların detaylarını (sarı/kırmızı kart, pas isabeti, İY skoru) çek
    const now = Date.now();
    const pending = Object.values(store.fixtures)
      .filter(
        (f) =>
          FINISHED.has(f.status) &&
          leagues.includes(f.leagueId) &&
          !f.detailFetched &&
          (!f.statsUnavailable || now - (f.statsTriedAt ?? 0) > RETRY_UNAVAILABLE_MS)
      )
      .sort((a, b) => b.ts - a.ts);

    Object.assign(state, {
      phase: "stats",
      done: 0,
      total: pending.length,
      message: `${pending.length} maçın kart, pas ve İY detayları indiriliyor...`,
    });

    sinceSave = 0;
    await runPool(pending, 8, async (fx) => {
      const lg = leagueById(fx.leagueId);
      if (!lg) return;
      try {
        const detail = await fetchEspnSummary(lg, fx);
        fx.statsTriedAt = Date.now();
        if (detail?.stats) {
          fx.stats = detail.stats;
          fx.detailFetched = true;
          fx.statsUnavailable = false;
        } else {
          fx.detailFetched = true;
        }
        if (detail?.ht) fx.ht = detail.ht;
        if (detail?.players) fx.players = detail.players;
        if (detail?.referee) fx.referee = detail.referee;
      } catch {
        fx.statsTriedAt = Date.now();
        fx.statsUnavailable = true;
      }
      state.done++;
      state.message = `Detaylı istatistikler: ${state.done}/${state.total} (${fx.home.name} - ${fx.away.name})`;
      if (++sinceSave >= 30) {
        saveStore(store);
        sinceSave = 0;
      }
    });

    store.lastStatsSync = new Date().toISOString();
    saveStore(store);
    Object.assign(state, { running: false, phase: "done", message: "Tüm veriler güncel (2026-27 sezonu).", finishedAt: Date.now() });
  } catch (err) {
    saveStore(store);
    Object.assign(state, {
      running: false,
      phase: "error",
      error: err instanceof Error ? err.message : String(err),
      message: "Senkronizasyon durdu.",
      finishedAt: Date.now(),
    });
  }
}

async function runApiFootballSync(apiKey: string, leagues: number[], mode: "full" | "lists", state: SyncState) {
  const store = loadStore();
  const meta: ApiMeta = {};
  try {
    for (const leagueId of leagues) {
      state.message = `${leagueById(leagueId)?.name ?? leagueId} fikstürü alınıyor...`;
      const items = await apiGet(apiKey, "fixtures", { league: leagueId, season: store.season }, meta);
      for (const item of items) {
        const fx = parseFixture(item, store.season);
        if (!fx.id) continue;
        const prev = store.fixtures[fx.id];
        store.fixtures[fx.id] = prev
          ? { ...fx, stats: prev.stats, statsTriedAt: prev.statsTriedAt, statsUnavailable: prev.statsUnavailable }
          : fx;
      }
      state.done++;
      state.dailyRemaining = meta.dailyRemaining;
    }
    store.lastListSync = new Date().toISOString();
    saveStore(store);

    if (mode === "lists") {
      Object.assign(state, { running: false, phase: "done", message: "Fikstürler güncellendi.", finishedAt: Date.now() });
      return;
    }

    const now = Date.now();
    const pending = Object.values(store.fixtures)
      .filter(
        (f) =>
          FINISHED.has(f.status) &&
          leagues.includes(f.leagueId) &&
          !f.stats &&
          (!f.statsUnavailable || now - (f.statsTriedAt ?? 0) > RETRY_UNAVAILABLE_MS)
      )
      .sort((a, b) => b.ts - a.ts);

    Object.assign(state, { phase: "stats", done: 0, total: pending.length, message: `${pending.length} maçın istatistiği indiriliyor...` });

    let sinceSave = 0;
    for (const fx of pending) {
      const resp = await apiGet(apiKey, "fixtures/statistics", { fixture: fx.id }, meta);
      const stats = parseStatistics(resp, fx.home.id, fx.away.id);
      fx.statsTriedAt = Date.now();
      if (stats) {
        fx.stats = stats;
        fx.statsUnavailable = false;
      } else {
        fx.statsUnavailable = true;
      }
      state.done++;
      state.dailyRemaining = meta.dailyRemaining;
      state.message = `İstatistikler: ${state.done}/${state.total} (${fx.home.name} - ${fx.away.name})`;
      if (++sinceSave >= 20) {
        saveStore(store);
        sinceSave = 0;
      }
    }
    store.lastStatsSync = new Date().toISOString();
    saveStore(store);
    Object.assign(state, { running: false, phase: "done", message: "Tüm veriler güncel.", finishedAt: Date.now() });
  } catch (err) {
    saveStore(store);
    const msg = err instanceof Error ? err.message : String(err);
    const hint =
      err instanceof ApiFootballError && err.kind === "plan"
        ? " Ücretsiz plan güncel sezona erişemiyor; Veri Ayarları'ndan ücretsiz ESPN kaynağını seçebilirsiniz."
        : err instanceof ApiFootballError && err.kind === "limit"
        ? " Kalan maçlar yarın senkronizasyonda devam eder."
        : "";
    Object.assign(state, { running: false, phase: "error", error: msg + hint, message: "Senkronizasyon durdu.", finishedAt: Date.now() });
  }
}
