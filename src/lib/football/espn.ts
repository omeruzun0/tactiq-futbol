/* eslint-disable @typescript-eslint/no-explicit-any */
import { LeagueDef, leagueById } from "./leagues";
import { FINISHED, PlayerMatchStat, StoredFixture, TeamStatLine, loadStore, saveStore } from "./store";

const BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer";

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`ESPN HTTP ${res.status}`);
  return res.json();
}

function num(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(String(v).replace("%", ""));
  return Number.isFinite(n) ? n : undefined;
}

function parseCompetitorStats(arr: any[] | undefined): TeamStatLine {
  const out: TeamStatLine = {};
  if (!Array.isArray(arr)) return out;
  for (const s of arr) {
    const name = String(s.name || "");
    const val = num(s.displayValue ?? s.value);
    if (val === undefined) continue;
    if (name === "foulsCommitted") out.fouls = val;
    else if (name === "wonCorners") out.corners = val;
    else if (name === "totalShots") out.shots = val;
    else if (name === "shotsOnTarget") out.sot = val;
    else if (name === "possessionPct") out.possession = val;
    else if (name === "yellowCards") out.yellow = val;
    else if (name === "redCards") out.red = val;
    else if (name === "offsides") out.offsides = val;
    else if (name === "passPct") out.passesPct = val <= 1 ? Math.round(val * 1000) / 10 : val;
  }
  return out;
}

function parseRosterPlayers(rosterEntries: any[] | undefined): PlayerMatchStat[] {
  if (!Array.isArray(rosterEntries)) return [];
  const out: PlayerMatchStat[] = [];
  for (const entry of rosterEntries) {
    const id = Number(entry?.athlete?.id);
    const name = String(entry?.athlete?.displayName || entry?.athlete?.shortName || "");
    if (!id || !name) continue;
    const stats: any[] = entry?.stats || [];
    const get = (k: string) => {
      const found = stats.find((s) => s.name === k);
      return num(found?.displayValue ?? found?.value) ?? 0;
    };
    const app = get("appearances");
    const subIn = get("subIns");
    const starter = Boolean(entry.starter);
    if (!starter && app === 0 && subIn === 0) continue; // oynamayan yedek
    out.push({
      id,
      name,
      pos: String(entry?.position?.abbreviation || ""),
      starter,
      foulsCommitted: get("foulsCommitted"),
      foulsSuffered: get("foulsSuffered"),
      yellow: get("yellowCards"),
      red: get("redCards"),
      shots: get("totalShots"),
      sot: get("shotsOnTarget"),
      goals: get("totalGoals"),
    });
  }
  return out;
}

function mapStatus(ev: any): string {
  const type = ev?.status?.type;
  if (!type) return "NS";
  if (type.completed) {
    const name = String(type.name || "");
    if (name.includes("PEN")) return "PEN";
    if (name.includes("AET") || name.includes("EXTRA")) return "AET";
    return "FT";
  }
  if (type.state === "in") return "LIVE";
  return "NS";
}

export function parseEspnEvent(
  ev: any,
  league: LeagueDef,
  season: number
): StoredFixture | null {
  const comp = ev?.competitions?.[0];
  const competitors: any[] = comp?.competitors || [];
  const homeC = competitors.find((c) => c.homeAway === "home");
  const awayC = competitors.find((c) => c.homeAway === "away");
  if (!homeC?.team?.id || !awayC?.team?.id) return null;

  const status = mapStatus(ev);
  const finished = status === "FT" || status === "AET" || status === "PEN";
  const hScore = finished || status === "LIVE" ? num(homeC.score) ?? null : null;
  const aScore = finished || status === "LIVE" ? num(awayC.score) ?? null : null;

  const hStats = parseCompetitorStats(homeC.statistics);
  const aStats = parseCompetitorStats(awayC.statistics);
  const hasStats =
    hStats.fouls !== undefined ||
    hStats.shots !== undefined ||
    hStats.corners !== undefined;

  return {
    id: Number(ev.id),
    leagueId: league.id,
    leagueName: league.name,
    season,
    date: ev.date,
    ts: Date.parse(ev.date),
    status,
    venue: comp?.venue?.fullName ?? undefined,
    home: {
      id: Number(homeC.team.id),
      name: String(homeC.team.displayName || homeC.team.name),
      logo: homeC.team.logo ?? undefined,
    },
    away: {
      id: Number(awayC.team.id),
      name: String(awayC.team.displayName || awayC.team.name),
      logo: awayC.team.logo ?? undefined,
    },
    goals: { home: hScore, away: aScore },
    ht: { home: null, away: null },
    stats: hasStats ? { home: hStats, away: aStats } : undefined,
  };
}

export async function getEspnMatchDays(
  league: LeagueDef,
  season: number
): Promise<string[]> {
  const j = await fetchJson(`${BASE}/${league.espnSlug}/scoreboard`);
  const cal = j?.leagues?.[0]?.calendar;

  const now = new Date();
  const maxDate = new Date(now.getTime() + 10 * 86400000);
  const minDate = new Date(season, 7, 1);

  if (Array.isArray(cal) && cal.length > 3 && typeof cal[0] === "string") {
    const days = new Set<string>();
    for (const iso of cal) {
      const d = new Date(iso);
      if (d >= minDate && d <= maxDate) days.add(ymd(d));
    }
    return [...days].sort();
  }

  const start = new Date(season, 8, 1);
  const days: string[] = [];
  const cur = new Date(start);
  while (cur <= maxDate) {
    const dow = cur.getDay();
    if (dow === 2 || dow === 3 || dow === 4) days.push(ymd(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

export async function fetchEspnDayEvents(
  league: LeagueDef,
  dayYmd: string,
  season: number
): Promise<StoredFixture[]> {
  const j = await fetchJson(`${BASE}/${league.espnSlug}/scoreboard?dates=${dayYmd}`);
  const events: any[] = j?.events || [];
  const out: StoredFixture[] = [];
  for (const ev of events) {
    const parsed = parseEspnEvent(ev, league, season);
    if (parsed) out.push(parsed);
  }
  return out;
}

export async function fetchEspnSummary(
  league: LeagueDef,
  fixture: StoredFixture
): Promise<{
  stats?: { home: TeamStatLine; away: TeamStatLine };
  ht?: { home: number | null; away: number | null };
  players?: { home: PlayerMatchStat[]; away: PlayerMatchStat[] };
  referee?: string;
} | null> {
  const j = await fetchJson(`${BASE}/${league.espnSlug}/summary?event=${fixture.id}`);
  const teams: any[] = j?.boxscore?.teams || [];
  const homeBox = teams.find((t) => t.homeAway === "home" || Number(t.team?.id) === fixture.home.id);
  const awayBox = teams.find((t) => t.homeAway === "away" || Number(t.team?.id) === fixture.away.id);

  const hStats = parseCompetitorStats(homeBox?.statistics);
  const aStats = parseCompetitorStats(awayBox?.statistics);

  // İlk yarı skoru
  const comp = j?.header?.competitions?.[0];
  const comps: any[] = comp?.competitors || [];
  const hc = comps.find((c) => c.homeAway === "home");
  const ac = comps.find((c) => c.homeAway === "away");
  const htHome = num(hc?.linescores?.[0]?.displayValue) ?? null;
  const htAway = num(ac?.linescores?.[0]?.displayValue) ?? null;

  // Oyuncu bazlı istatistikler
  const rosters: any[] = j?.rosters || [];
  const hRos = rosters.find((r) => r.homeAway === "home" || Number(r.team?.id) === fixture.home.id);
  const aRos = rosters.find((r) => r.homeAway === "away" || Number(r.team?.id) === fixture.away.id);
  const homePlayers = parseRosterPlayers(hRos?.roster);
  const awayPlayers = parseRosterPlayers(aRos?.roster);

  const referee = j?.gameInfo?.officials?.[0]?.displayName ?? undefined;

  const mergedHome = { ...(fixture.stats?.home || {}), ...hStats };
  const mergedAway = { ...(fixture.stats?.away || {}), ...aStats };
  const hasStats =
    mergedHome.fouls !== undefined ||
    mergedHome.shots !== undefined ||
    mergedHome.yellow !== undefined;

  return {
    stats: hasStats ? { home: mergedHome, away: mergedAway } : undefined,
    ht: htHome !== null && htAway !== null ? { home: htHome, away: htAway } : undefined,
    players: homePlayers.length || awayPlayers.length ? { home: homePlayers, away: awayPlayers } : undefined,
    referee,
  };
}

/**
 * İki takımın son N bitmiş maçında oyuncu verisi eksikse, sadece o maçlar için
 * ESPN summary'den oyuncu istatistiklerini hızlıca (paralel) indirip önbelleğe kaydeder.
 */
export async function ensurePlayersForTeams(teamIds: number[], recentLimit = 6): Promise<void> {
  const store = loadStore();
  if (store.source !== "espn") return;

  const toFetchMap = new Map<number, StoredFixture>();
  for (const tid of teamIds) {
    const recent = Object.values(store.fixtures)
      .filter((f) => FINISHED.has(f.status) && (f.home.id === tid || f.away.id === tid))
      .sort((a, b) => b.ts - a.ts)
      .slice(0, recentLimit);
    for (const fx of recent) {
      if (!fx.players) toFetchMap.set(fx.id, fx);
    }
  }

  const list = [...toFetchMap.values()];
  if (list.length === 0) return;

  let changed = false;
  await Promise.all(
    list.map(async (fx) => {
      const lg = leagueById(fx.leagueId);
      if (!lg) return;
      try {
        const detail = await fetchEspnSummary(lg, fx);
        if (detail?.players) {
          fx.players = detail.players;
          changed = true;
        }
        if (detail?.stats) {
          fx.stats = detail.stats;
          changed = true;
        }
        if (detail?.ht) fx.ht = detail.ht;
      } catch {
        // yoksay
      }
    })
  );

  if (changed) saveStore(store);
}
