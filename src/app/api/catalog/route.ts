import { NextRequest, NextResponse } from "next/server";
import { getDataset, leagueName } from "@/lib/football/dataset";
import { UPCOMING, loadStore } from "@/lib/football/store";

export const dynamic = "force-dynamic";

/** Takım listesi + yaklaşan maç bülteni */
export async function GET(req: NextRequest) {
  const days = Math.min(14, Math.max(1, Number(req.nextUrl.searchParams.get("days") || 3)));
  const ds = getDataset();
  const store = loadStore();

  const teams = [...ds.teams.values()]
    .map((t) => ({
      id: t.id,
      name: t.name,
      logo: t.logo,
      league: leagueName(t.domesticLeague) ?? "Avrupa",
      played: t.matches.length,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "tr"));

  const now = Date.now();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const until = now + days * 86400000;
  const fixtures = Object.values(store.fixtures)
    .filter((f) => f.ts >= startOfToday.getTime() && f.ts <= until && (UPCOMING.has(f.status) || f.ts >= now - 3 * 3600000))
    .sort((a, b) => a.ts - b.ts)
    .map((f) => ({
      id: f.id,
      leagueId: f.leagueId,
      leagueName: f.leagueName,
      date: f.date,
      status: f.status,
      referee: f.referee ?? null,
      home: f.home,
      away: f.away,
      goals: f.goals,
    }));

  return NextResponse.json({ teams, fixtures });
}
