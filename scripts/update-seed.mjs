import fs from "fs";
import path from "path";
import zlib from "zlib";

const SEED_FILE = path.join(process.cwd(), "src", "data", "seed-store.json.gz");
const BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer";

const LEAGUES = [
  { id: 39, name: "Premier League", espnSlug: "eng.1", type: "league" },
  { id: 140, name: "LaLiga", espnSlug: "esp.1", type: "league" },
  { id: 135, name: "Serie A", espnSlug: "ita.1", type: "league" },
  { id: 78, name: "Bundesliga", espnSlug: "ger.1", type: "league" },
  { id: 61, name: "Ligue 1", espnSlug: "fra.1", type: "league" },
  { id: 203, name: "Süper Lig", espnSlug: "tur.1", type: "league" },
  { id: 88, name: "Eredivisie", espnSlug: "ned.1", type: "league" },
  { id: 94, name: "Primeira Liga", espnSlug: "por.1", type: "league" },
  { id: 2, name: "Şampiyonlar Ligi", espnSlug: "uefa.champions", type: "europe" },
  { id: 3, name: "Avrupa Ligi", espnSlug: "uefa.europa", type: "europe" },
];

const FINISHED = new Set(["FT", "AET", "PEN"]);

function currentSeason(now = new Date()) {
  return now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
}

function ymd(d) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

function num(v) {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(String(v).replace("%", ""));
  return Number.isFinite(n) ? n : undefined;
}

function parseStats(arr) {
  const out = {};
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

function mapStatus(ev) {
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

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function runPool(items, concurrency, fn) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    })
  );
}

async function main() {
  const season = currentSeason();
  let store = { version: 2, season, source: "espn", fixtures: {}, updatedAt: 0 };
  if (fs.existsSync(SEED_FILE)) {
    const parsed = JSON.parse(zlib.gunzipSync(fs.readFileSync(SEED_FILE)).toString("utf8"));
    if (parsed.season === season) store = parsed;
  }

  // Son 4 gün + gelecek 10 günün tarihlerini tara (mevcut eski maçlar korunur)
  const now = new Date();
  const days = [];
  for (let offset = -4; offset <= 10; offset++) {
    const d = new Date(now.getTime() + offset * 86400000);
    days.push(ymd(d));
  }

  const tasks = [];
  for (const lg of LEAGUES) {
    for (const day of days) tasks.push({ lg, day });
  }

  console.log(`Checking ${tasks.length} league-days for season ${season}...`);
  await runPool(tasks, 8, async ({ lg, day }) => {
    try {
      const j = await fetchJson(`${BASE}/${lg.espnSlug}/scoreboard?dates=${day}`);
      for (const ev of j.events || []) {
        const comp = ev?.competitions?.[0];
        const comps = comp?.competitors || [];
        const h = comps.find((c) => c.homeAway === "home");
        const a = comps.find((c) => c.homeAway === "away");
        if (!h?.team?.id || !a?.team?.id) continue;
        const status = mapStatus(ev);
        const fin = FINISHED.has(status);
        const hStats = parseStats(h.statistics);
        const aStats = parseStats(a.statistics);
        const hasStats = hStats.fouls !== undefined || hStats.shots !== undefined;
        const prev = store.fixtures[ev.id];
        store.fixtures[ev.id] = {
          id: Number(ev.id),
          leagueId: lg.id,
          leagueName: lg.name,
          season,
          date: ev.date,
          ts: Date.parse(ev.date),
          status,
          venue: comp?.venue?.fullName ?? prev?.venue,
          referee: prev?.referee,
          home: { id: Number(h.team.id), name: String(h.team.displayName || h.team.name), logo: h.team.logo },
          away: { id: Number(a.team.id), name: String(a.team.displayName || a.team.name), logo: a.team.logo },
          goals: { home: fin ? num(h.score) ?? null : null, away: fin ? num(a.score) ?? null : null },
          ht: prev?.ht ?? { home: null, away: null },
          stats: prev?.detailFetched ? prev.stats : hasStats ? { home: hStats, away: aStats } : prev?.stats,
          detailFetched: prev?.detailFetched ?? false,
        };
      }
    } catch {
      // boş gün
    }
  });

  // Yeni biten ama detayı (kart, pas, İY skoru) çekilmemiş maçları tamamla
  const pending = Object.values(store.fixtures).filter((f) => FINISHED.has(f.status) && !f.detailFetched);
  console.log(`Fetching summaries for ${pending.length} newly finished matches...`);
  await runPool(pending, 8, async (fx) => {
    const lg = LEAGUES.find((l) => l.id === fx.leagueId);
    if (!lg) return;
    try {
      const j = await fetchJson(`${BASE}/${lg.espnSlug}/summary?event=${fx.id}`);
      const teams = j?.boxscore?.teams || [];
      const hb = teams.find((t) => t.homeAway === "home" || Number(t.team?.id) === fx.home.id);
      const ab = teams.find((t) => t.homeAway === "away" || Number(t.team?.id) === fx.away.id);
      const hStats = parseStats(hb?.statistics);
      const aStats = parseStats(ab?.statistics);
      fx.stats = { home: { ...(fx.stats?.home || {}), ...hStats }, away: { ...(fx.stats?.away || {}), ...aStats } };
      const comps = j?.header?.competitions?.[0]?.competitors || [];
      const hc = comps.find((c) => c.homeAway === "home");
      const ac = comps.find((c) => c.homeAway === "away");
      const htH = num(hc?.linescores?.[0]?.displayValue);
      const htA = num(ac?.linescores?.[0]?.displayValue);
      if (htH !== undefined && htA !== undefined) fx.ht = { home: htH, away: htA };
      if (j?.gameInfo?.officials?.[0]?.displayName) fx.referee = j.gameInfo.officials[0].displayName;
      fx.detailFetched = true;
    } catch {
      // yoksay
    }
  });

  store.lastListSync = new Date().toISOString();
  store.lastStatsSync = store.lastListSync;
  store.updatedAt = Date.now();

  fs.mkdirSync(path.dirname(SEED_FILE), { recursive: true });
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(store)), { level: 9 });
  fs.writeFileSync(SEED_FILE, gz);
  const finCount = Object.values(store.fixtures).filter((f) => FINISHED.has(f.status)).length;
  console.log(`Done! Total finished: ${finCount}, seed size: ${(gz.length / 1024).toFixed(1)} KB`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
