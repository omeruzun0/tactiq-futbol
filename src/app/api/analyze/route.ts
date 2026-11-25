import { NextRequest, NextResponse } from "next/server";
import { analyzeMatch } from "@/lib/football/analyze";
import { ensurePlayersForTeams } from "@/lib/football/espn";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const home = Number(sp.get("home"));
  const away = Number(sp.get("away"));
  if (!home || !away || home === away) {
    return NextResponse.json({ error: "İki farklı takım seçin." }, { status: 400 });
  }
  try {
    // İki takımın son 6 maçındaki oyuncu verilerini (henüz önbellekte yoksa) hızlıca yükle
    await ensurePlayersForTeams([home, away], 6);

    const missingRaw = sp.get("missing") || "";
    const missingPlayerIds = missingRaw
      .split(",")
      .map((x) => Number(x.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);

    const result = analyzeMatch(home, away, {
      fixtureId: sp.get("fixture") ? Number(sp.get("fixture")) : undefined,
      leagueId: sp.get("league") ? Number(sp.get("league")) : undefined,
      referee: sp.get("referee") || undefined,
      missingPlayerIds,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Analiz hatası" },
      { status: 500 }
    );
  }
}
