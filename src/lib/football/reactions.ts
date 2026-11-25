import { Dataset, TeamInfo } from "./dataset";
import { Metric, PlayerImpactProfile, TacticalReaction } from "./types";

export interface ReactionMultipliers {
  home: Partial<Record<Metric, number>>;
  away: Partial<Record<Metric, number>>;
  reactions: TacticalReaction[];
}

function mult(obj: Partial<Record<Metric, number>>, m: Metric, factor: number) {
  obj[m] = (obj[m] ?? 1) * factor;
}

/**
 * İki takımın oyun tarzlarının çarpışmasından doğan taktiksel reaksiyonları
 * ve eksik/yedek kilit oyuncuların pazarlara etkisini hesaplar.
 */
export function computeReactionsAndPlayerImpact(
  ds: Dataset,
  H: TeamInfo,
  A: TeamInfo,
  homePlayers: PlayerImpactProfile[],
  awayPlayers: PlayerImpactProfile[]
): ReactionMultipliers {
  const hp = ds.profiles.get(H.id)?.pct ?? {};
  const ap = ds.profiles.get(A.id)?.pct ?? {};
  const home: Partial<Record<Metric, number>> = {};
  const away: Partial<Record<Metric, number>> = {};
  const reactions: TacticalReaction[] = [];

  // 1) OFSAYT TUZAĞI ÇARPIŞMASI (Kullanıcının özellikle vurguladığı senaryo)
  const checkOffsideTrap = (
    attacker: TeamInfo,
    defender: TeamInfo,
    attPct: typeof hp,
    defPct: typeof hp,
    side: "home" | "away"
  ) => {
    const trap = defPct.offsidesForced ?? 50;
    const direct = attPct.directness ?? 50;
    const attOff = attPct.offsidesCommitted ?? 50;
    if (trap >= 72) {
      // Rakip ofsayt tuzağında elit: dikine/hızlı oynayan takıma karşı çarpan daha yüksek
      const bonus = direct >= 60 || attOff >= 60 ? 1.14 : 1.08;
      mult(side === "home" ? home : away, "offsides", bonus);
      reactions.push({
        id: `offside-trap-${side}`,
        title: `${defender.name} Ofsayt Tuzağı Etkisi`,
        target: side,
        metric: "offsides",
        multiplier: bonus,
        explanation:
          attOff < 45
            ? `${attacker.name} normalde az ofsayta düşen bir takım (%${attOff} dilim) olsa da, ${defender.name} ofsayt tuzağında liglerin en üst diliminde (%${trap}). Yüksek savunma hattı ${attacker.name}'in ofsayt sayısını normal ortalamasının üstüne çeker.`
            : `${defender.name} yüksek savunma hattıyla rakiplerini sık ofsayta düşürüyor (%${trap} dilim). ${attacker.name}'in dikine hücumları (%${direct}) bu tuzağa sık yakalanma riski taşıyor.`,
      });
    }
  };
  checkOffsideTrap(H, A, hp, ap, "home");
  checkOffsideTrap(A, H, ap, hp, "away");

  // 2) TOPA SAHİP OLMA + FAUL ALAN TAKIM vs YOĞUN PRES / SERT OYUN (FAUL & KART)
  const checkFoulPress = (
    fouler: TeamInfo,
    carrier: TeamInfo,
    fPct: typeof hp,
    cPct: typeof hp,
    side: "home" | "away"
  ) => {
    const poss = cPct.possession ?? 50;
    const drawn = cPct.foulsDrawn ?? 50;
    const press = fPct.press ?? 50;
    const rough = fPct.foulsCommitted ?? 50;
    if ((poss >= 66 || drawn >= 70) && (press >= 60 || rough >= 62)) {
      const fMult = 1.07;
      const yMult = 1.08;
      mult(side === "home" ? home : away, "fouls", fMult);
      mult(side === "home" ? home : away, "yellow", yMult);
      reactions.push({
        id: `foul-press-${side}`,
        title: `${fouler.name} Pres & Faul Baskısı`,
        target: side,
        metric: "fouls",
        multiplier: fMult,
        explanation: `${carrier.name} topu ayağında tutan (%${poss}) ve çok faul alan (%${drawn}) bir ekip. ${fouler.name}'in ön alan baskısı (%${press}) ve sertlik seviyesi (%${rough}) faul ve sarı kart sayısını yukarı çekiyor.`,
      });
    }
  };
  checkFoulPress(H, A, hp, ap, "home");
  checkFoulPress(A, H, ap, hp, "away");

  // 3) KAPALI SAVUNMA (DÜŞÜK BLOK) vs KANAT / KORNER BASKISI
  const checkCornerSiege = (
    attacker: TeamInfo,
    defender: TeamInfo,
    attPct: typeof hp,
    defPct: typeof hp,
    side: "home" | "away"
  ) => {
    const attPoss = attPct.possession ?? 50;
    const attCor = attPct.cornersFor ?? 50;
    const defPoss = defPct.possession ?? 50;
    if (attPoss >= 65 && attCor >= 65 && defPoss <= 42) {
      const cMult = 1.09;
      mult(side === "home" ? home : away, "corners", cMult);
      mult(side === "home" ? home : away, "shots", 1.05);
      reactions.push({
        id: `corner-siege-${side}`,
        title: `${attacker.name} Abluka & Korner Baskısı`,
        target: side,
        metric: "corners",
        multiplier: cMult,
        explanation: `${defender.name} topu rakibe bırakıp derinde bekleyen bir profil (%${defPoss} topa sahip olma). ${attacker.name}'in topa hakim (%${attPoss}) ve kanat/korner ağırlıklı (%${attCor}) oyunu korner sayısını artırır.`,
      });
    }
  };
  checkCornerSiege(H, A, hp, ap, "home");
  checkCornerSiege(A, H, ap, hp, "away");

  // 4) OYUNCU BAZLI EKSİK ETKİSİ (Kullanıcının "Eksik / Yedek" işaretlediği oyuncular)
  const applyMissingPlayers = (
    team: TeamInfo,
    opp: TeamInfo,
    players: PlayerImpactProfile[],
    teamSide: "home" | "away"
  ) => {
    const missing = players.filter((p) => p.missing);
    if (!missing.length) return;
    const teamBucket = teamSide === "home" ? home : away;
    const oppBucket = teamSide === "home" ? away : home;

    const totalFc = players.reduce((s, p) => s + p.foulsCommittedPg, 0) || 10;
    const totalFs = players.reduce((s, p) => s + p.foulsSufferedPg, 0) || 10;
    const totalSh = players.reduce((s, p) => s + p.shotsPg, 0) || 12;
    const totalYc = players.reduce((s, p) => s + p.yellowPg, 0) || 2;

    let dropFc = 0;
    let dropFs = 0;
    let dropSh = 0;
    let dropYc = 0;
    for (const p of missing) {
      // Yerine ortalama bir yedek girdiği için ham payın ~%55'i kadar net etki uygulanır
      dropFc += (p.foulsCommittedPg / totalFc) * 0.55;
      dropFs += (p.foulsSufferedPg / totalFs) * 0.55;
      dropSh += (p.shotsPg / totalSh) * 0.55;
      dropYc += (p.yellowPg / totalYc) * 0.55;
    }

    const clamp = (d: number) => Math.max(0.75, 1 - Math.min(0.25, d));
    const names = missing.map((m) => m.name).join(", ");

    if (dropSh >= 0.05) {
      const m = clamp(dropSh);
      mult(teamBucket, "shots", m);
      mult(teamBucket, "sot", m);
      mult(teamBucket, "goals", Math.max(0.82, 1 - dropSh * 0.8));
      reactions.push({
        id: `missing-att-${teamSide}`,
        title: `${team.name} Eksik Hücum Etkisi`,
        target: teamSide,
        metric: "shots",
        multiplier: Math.round(m * 100) / 100,
        explanation: `${names} eksik işaretlendi; ${team.name}'in şut ve gol beklentisi aşağı çekildi.`,
      });
    }
    if (dropFs >= 0.06) {
      const m = clamp(dropFs);
      mult(oppBucket, "fouls", m);
      mult(oppBucket, "yellow", Math.max(0.84, 1 - dropFs * 0.7));
      reactions.push({
        id: `missing-drawn-${teamSide}`,
        title: `${team.name} Faul Alan Oyuncu Eksik`,
        target: teamSide === "home" ? "away" : "home",
        metric: "fouls",
        multiplier: Math.round(m * 100) / 100,
        explanation: `${team.name}'de sık faul alan ${names} oynamadığı için ${opp.name}'in faul ve kart beklentisi düşürüldü.`,
      });
    }
    if (dropFc >= 0.06 || dropYc >= 0.08) {
      const m = clamp(dropFc);
      mult(teamBucket, "fouls", m);
      mult(teamBucket, "yellow", clamp(dropYc));
    }
  };

  applyMissingPlayers(H, A, homePlayers, "home");
  applyMissingPlayers(A, H, awayPlayers, "away");

  return { home, away, reactions };
}
