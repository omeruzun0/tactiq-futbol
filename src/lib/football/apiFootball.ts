/* eslint-disable @typescript-eslint/no-explicit-any */
import { StoredFixture, TeamStatLine } from "./store";

const BASE = "https://v3.football.api-sports.io";

export class ApiFootballError extends Error {
  constructor(message: string, public kind: "limit" | "plan" | "token" | "http" | "other") {
    super(message);
  }
}

export interface ApiMeta {
  dailyRemaining?: number;
  minuteLimit?: number;
}

let lastCallAt = 0;
let minIntervalMs = 250;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function apiGet(
  apiKey: string,
  endpoint: string,
  params: Record<string, string | number>,
  meta?: ApiMeta
): Promise<any[]> {
  const qs = new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)])
  ).toString();

  for (let attempt = 0; attempt < 4; attempt++) {
    const wait = lastCallAt + minIntervalMs - Date.now();
    if (wait > 0) await sleep(wait);
    lastCallAt = Date.now();

    const res = await fetch(`${BASE}/${endpoint}?${qs}`, {
      headers: { "x-apisports-key": apiKey },
      cache: "no-store",
    });

    const minuteLimit = Number(res.headers.get("x-ratelimit-limit"));
    const minuteRemaining = Number(res.headers.get("x-ratelimit-remaining"));
    const daily = res.headers.get("x-ratelimit-requests-remaining");
    if (meta) {
      if (daily !== null) meta.dailyRemaining = Number(daily);
      if (minuteLimit) meta.minuteLimit = minuteLimit;
    }
    if (minuteLimit > 0) {
      minIntervalMs = Math.max(220, Math.ceil(60000 / minuteLimit) + 60);
    }

    if (res.status === 429) {
      await sleep(30000);
      continue;
    }
    if (!res.ok) {
      throw new ApiFootballError(`API-Football HTTP ${res.status}`, "http");
    }

    const json = await res.json();
    const errors = json.errors;
    const hasErrors =
      errors && (Array.isArray(errors) ? errors.length > 0 : Object.keys(errors).length > 0);
    if (hasErrors) {
      const msg = Array.isArray(errors) ? errors.join(", ") : Object.values(errors).join(", ");
      const keys = Array.isArray(errors) ? [] : Object.keys(errors);
      if (keys.includes("rateLimit")) {
        await sleep(20000);
        continue;
      }
      if (keys.includes("requests")) throw new ApiFootballError(`Günlük istek limiti doldu: ${msg}`, "limit");
      if (keys.includes("plan")) throw new ApiFootballError(`Plan kısıtı: ${msg}`, "plan");
      if (keys.includes("token") || keys.includes("access"))
        throw new ApiFootballError(`API anahtarı geçersiz: ${msg}`, "token");
      throw new ApiFootballError(msg, "other");
    }

    if (minuteRemaining === 0) await sleep(Math.max(1000, minIntervalMs * 2));
    return Array.isArray(json.response) ? json.response : [];
  }
  throw new ApiFootballError("API-Football hız limiti nedeniyle istek tamamlanamadı.", "limit");
}

export function parseFixture(item: any, season: number): StoredFixture {
  const f = item.fixture ?? {};
  const l = item.league ?? {};
  const t = item.teams ?? {};
  const goals = item.goals ?? {};
  const score = item.score ?? {};
  return {
    id: f.id,
    leagueId: l.id,
    leagueName: l.name,
    season,
    round: l.round,
    date: f.date,
    ts: (f.timestamp ?? 0) * 1000,
    status: f.status?.short ?? "NS",
    referee: f.referee ? String(f.referee).split(",")[0].trim() : undefined,
    venue: f.venue?.name ?? undefined,
    home: { id: t.home?.id, name: t.home?.name, logo: t.home?.logo },
    away: { id: t.away?.id, name: t.away?.name, logo: t.away?.logo },
    goals: { home: goals.home ?? null, away: goals.away ?? null },
    ht: {
      home: score.halftime?.home ?? null,
      away: score.halftime?.away ?? null,
    },
  };
}

const ZERO_IF_NULL = new Set(["yellow", "red", "corners", "offsides"]);
const TYPE_MAP: Record<string, keyof TeamStatLine> = {
  "Total Shots": "shots",
  "Shots on Goal": "sot",
  Fouls: "fouls",
  "Corner Kicks": "corners",
  "Yellow Cards": "yellow",
  "Red Cards": "red",
  "Ball Possession": "possession",
  Offsides: "offsides",
  expected_goals: "xg",
  "Passes %": "passesPct",
};

export function parseStatistics(
  response: any[],
  homeId: number,
  awayId: number
): { home: TeamStatLine; away: TeamStatLine } | null {
  if (!Array.isArray(response) || response.length < 2) return null;
  const out: { home: TeamStatLine; away: TeamStatLine } = { home: {}, away: {} };
  for (const entry of response) {
    const side = entry?.team?.id === homeId ? "home" : entry?.team?.id === awayId ? "away" : null;
    if (!side) continue;
    for (const st of entry.statistics ?? []) {
      const key = TYPE_MAP[st.type];
      if (!key) continue;
      let v: number | undefined;
      if (st.value === null || st.value === undefined) {
        v = ZERO_IF_NULL.has(key) ? 0 : undefined;
      } else if (typeof st.value === "string") {
        const n = parseFloat(st.value.replace("%", ""));
        v = Number.isFinite(n) ? n : undefined;
      } else {
        v = Number(st.value);
      }
      if (v !== undefined) out[side][key] = v;
    }
  }
  if (out.home.shots === undefined && out.home.fouls === undefined) return null;
  return out;
}
