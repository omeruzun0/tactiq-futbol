import fs from "fs";
import path from "path";
import { DEFAULT_LEAGUE_IDS, currentSeason } from "./leagues";

export interface TeamStatLine {
  shots?: number;
  sot?: number;
  fouls?: number;
  corners?: number;
  yellow?: number;
  red?: number;
  possession?: number;
  offsides?: number;
  xg?: number;
  passesPct?: number;
}

export interface PlayerMatchStat {
  id: number;
  name: string;
  pos: string;
  starter: boolean;
  foulsCommitted: number;
  foulsSuffered: number;
  yellow: number;
  red: number;
  shots: number;
  sot: number;
  goals: number;
}

export interface TeamRef {
  id: number;
  name: string;
  logo?: string;
}

export interface StoredFixture {
  id: number;
  leagueId: number;
  leagueName: string;
  season: number;
  round?: string;
  date: string;
  ts: number;
  status: string;
  referee?: string;
  venue?: string;
  home: TeamRef;
  away: TeamRef;
  goals: { home: number | null; away: number | null };
  ht: { home: number | null; away: number | null };
  stats?: { home: TeamStatLine; away: TeamStatLine };
  players?: { home: PlayerMatchStat[]; away: PlayerMatchStat[] };
  detailFetched?: boolean;
  statsTriedAt?: number;
  statsUnavailable?: boolean;
}

export interface StoreData {
  version: number;
  season: number;
  source: "espn" | "apifootball";
  fixtures: Record<string, StoredFixture>;
  lastListSync?: string;
  lastStatsSync?: string;
  updatedAt: number;
}

export type DataSource = "espn" | "apifootball";

export interface AppConfig {
  source: DataSource;
  apiKey?: string;
  leagues: number[];
}

const DATA_DIR = path.join(process.cwd(), "data");
const STORE_FILE = path.join(DATA_DIR, "store.json");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");

type G = typeof globalThis & {
  __fbStore?: StoreData;
  __fbConfig?: AppConfig;
};
const g = globalThis as G;

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

export const FINISHED = new Set(["FT", "AET", "PEN"]);
export const UPCOMING = new Set(["NS", "TBD"]);

export function loadStore(): StoreData {
  const cfg = loadConfig();
  if (g.__fbStore && g.__fbStore.source === cfg.source) return g.__fbStore;
  const season = currentSeason();
  let data: StoreData = {
    version: 2,
    season,
    source: cfg.source,
    fixtures: {},
    updatedAt: 0,
  };
  try {
    if (fs.existsSync(STORE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(STORE_FILE, "utf8")) as StoreData;
      if (parsed.season === season && parsed.source === cfg.source) {
        data = parsed;
      }
    }
  } catch {
    // bozuk dosya: sıfırdan başla
  }
  g.__fbStore = data;
  return data;
}

export function saveStore(data: StoreData) {
  ensureDir();
  data.updatedAt = Date.now();
  g.__fbStore = data;
  const tmp = STORE_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, STORE_FILE);
}

export function loadConfig(): AppConfig {
  if (g.__fbConfig) return g.__fbConfig;
  let cfg: AppConfig = { source: "espn", leagues: DEFAULT_LEAGUE_IDS };
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) as Partial<AppConfig>;
      cfg = {
        source: parsed.source === "apifootball" ? "apifootball" : "espn",
        apiKey: parsed.apiKey,
        leagues: parsed.leagues?.length ? parsed.leagues : DEFAULT_LEAGUE_IDS,
      };
    }
  } catch {
    // varsayılan
  }
  if (!cfg.apiKey && process.env.API_FOOTBALL_KEY) {
    cfg.apiKey = process.env.API_FOOTBALL_KEY;
  }
  g.__fbConfig = cfg;
  return cfg;
}

export function saveConfig(cfg: AppConfig) {
  ensureDir();
  g.__fbConfig = cfg;
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}
