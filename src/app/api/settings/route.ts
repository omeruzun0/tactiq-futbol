import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_LEAGUE_IDS } from "@/lib/football/leagues";
import { DataSource, loadConfig, saveConfig } from "@/lib/football/store";
import { getSyncState, startSync } from "@/lib/football/sync";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    source?: DataSource;
    apiKey?: string;
    leagues?: number[];
    action?: "sync" | "save";
  };
  const cfg = loadConfig();

  if (body.action !== "sync") {
    const next = {
      source: body.source ?? cfg.source ?? "espn",
      apiKey: body.apiKey !== undefined ? body.apiKey.trim() || undefined : cfg.apiKey,
      leagues: body.leagues?.length ? body.leagues : cfg.leagues ?? DEFAULT_LEAGUE_IDS,
    };
    saveConfig(next);
    const st = getSyncState();
    if (st.phase === "error") Object.assign(st, { phase: "idle", error: undefined });
  }

  const state = startSync("full");
  return NextResponse.json({ ok: true, sync: state });
}
