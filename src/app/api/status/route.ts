import { NextResponse } from "next/server";
import { ALL_LEAGUES } from "@/lib/football/leagues";
import { FINISHED, loadConfig, loadStore } from "@/lib/football/store";
import { getSyncState, startSync } from "@/lib/football/sync";

export const dynamic = "force-dynamic";

const LIST_REFRESH_MS = 6 * 3600 * 1000;

export async function GET() {
  const cfg = loadConfig();
  const store = loadStore();
  const sync = getSyncState();

  const canAutoSync = cfg.source === "espn" || Boolean(cfg.apiKey);
  if (canAutoSync && !sync.running && sync.phase !== "error") {
    const last = store.lastListSync ? Date.parse(store.lastListSync) : 0;
    if (Date.now() - last > LIST_REFRESH_MS) startSync("full");
  }

  const all = Object.values(store.fixtures);
  const finished = all.filter((f) => FINISHED.has(f.status));
  const perLeague = ALL_LEAGUES.map((l) => {
    const lf = finished.filter((f) => f.leagueId === l.id);
    return {
      id: l.id,
      name: l.name,
      enabled: cfg.leagues.includes(l.id),
      finished: lf.length,
      withStats: lf.filter((f) => f.stats).length,
    };
  });

  return NextResponse.json({
    source: cfg.source,
    hasKey: Boolean(cfg.apiKey),
    keyPreview: cfg.apiKey ? `${cfg.apiKey.slice(0, 4)}••••${cfg.apiKey.slice(-3)}` : null,
    season: store.season,
    leagues: perLeague,
    totals: {
      fixtures: all.length,
      finished: finished.length,
      withStats: finished.filter((f) => f.stats).length,
    },
    lastListSync: store.lastListSync ?? null,
    lastStatsSync: store.lastStatsSync ?? null,
    sync: getSyncState(),
  });
}
