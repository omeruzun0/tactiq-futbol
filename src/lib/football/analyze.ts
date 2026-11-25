import {
  COUNT_METRICS,
  Dataset,
  TeamInfo,
  TeamMatch,
  buildTeamPlayers,
  getDataset,
  getNorm,
  leagueName,
  profileView,
  relAgainst,
  relFor,
  similarity,
  valueAgainst,
  valueFor,
} from "./dataset";
import { isEuropeLeague, leagueById } from "./leagues";
import {
  convolve,
  negBinPmf,
  poissonPmf,
  rankTopPicks,
  scoreMatrix,
} from "./markets";
import { computeReactionsAndPlayerImpact } from "./reactions";
import {
  AnalysisResult,
  CountFamily,
  MarketGroup,
  Metric,
  OutcomeSelection,
  RefereeInfo,
  Sample,
  SimilarMatch,
  TeamSummary,
} from "./types";

const HALF_LIFE_DAYS = 150;

interface Weighted {
  m: TeamMatch;
  w: number;
  top: boolean;
}

function recency(ts: number, now: number) {
  const days = Math.max(0, (now - ts) / 86400000);
  return Math.pow(0.5, days / HALF_LIFE_DAYS);
}

function weightMatches(
  ds: Dataset,
  team: TeamInfo,
  target: TeamInfo,
  metric: Metric,
  wantHome: boolean,
  now: number,
  filter: (m: TeamMatch) => boolean
): Weighted[] {
  const list = team.matches
    .filter(filter)
    .map((m) => {
      const sim = Math.max(0.03, similarity(ds, m.oppId, target.id, metric));
      const venue = m.isHome === wantHome ? 1 : 0.75;
      return { m, w: sim * recency(m.ts, now) * venue, top: false };
    });
  [...list]
    .sort((a, b) => b.w - a.w)
    .slice(0, 8)
    .forEach((x) => (x.top = true));
  return list;
}

function wMean(items: Array<{ v: number; w: number }>) {
  let sw = 0;
  let sv = 0;
  let sw2 = 0;
  for (const it of items) {
    sw += it.w;
    sv += it.w * it.v;
    sw2 += it.w * it.w;
  }
  return { mean: sw > 0 ? sv / sw : 1, nEff: sw2 > 0 ? (sw * sw) / sw2 : 0, n: items.length };
}

function shrink(value: number, nEff: number, prior: number, k: number) {
  return (nEff * value + k * prior) / (nEff + k);
}

interface Estimate {
  lambda: number;
  aWeighted: Weighted[];
  bWeighted: Weighted[];
}

function estimateTeamMetric(
  ds: Dataset,
  A: TeamInfo,
  B: TeamInfo,
  metric: Metric,
  aIsHome: boolean,
  compId: number,
  now: number
): Estimate | null {
  const hasA = (m: TeamMatch) => valueFor(m, metric) !== undefined;
  const hasB = (m: TeamMatch) => valueAgainst(m, metric) !== undefined;
  const aW = weightMatches(ds, A, B, metric, aIsHome, now, hasA);
  const bW = weightMatches(ds, B, A, metric, !aIsHome, now, hasB);
  if (aW.length === 0 && bW.length === 0) return null;

  const aAll = wMean(aW.map((x) => ({ v: relFor(ds, x.m, metric)!, w: recency(x.m.ts, now) })));
  const aSim = wMean(aW.map((x) => ({ v: relFor(ds, x.m, metric)!, w: x.w })));
  const aPrior = shrink(aAll.mean, aAll.n, 1, 3);
  const aRel = aW.length ? shrink(aSim.mean, aSim.nEff, aPrior, 2) : 1;

  const bAll = wMean(bW.map((x) => ({ v: relAgainst(ds, x.m, metric)!, w: recency(x.m.ts, now) })));
  const bSim = wMean(bW.map((x) => ({ v: relAgainst(ds, x.m, metric)!, w: x.w })));
  const bPrior = shrink(bAll.mean, bAll.n, 1, 3);
  const bRel = bW.length ? shrink(bSim.mean, bSim.nEff, bPrior, 2) : 1;

  const compCell = ds.norms.get(compId)?.[metric];
  const compN = compCell ? (aIsHome ? compCell.nHome : compCell.nAway) : 0;
  let base: number;
  if (compN >= 30) {
    base = getNorm(ds, compId, metric, aIsHome);
  } else {
    const la = A.domesticLeague ?? compId;
    const lb = B.domesticLeague ?? compId;
    base = (getNorm(ds, la, metric, aIsHome) + getNorm(ds, lb, metric, aIsHome)) / 2;
  }

  return { lambda: Math.max(0.05, base * aRel * bRel), aWeighted: aW, bWeighted: bW };
}

function makeLines(mean: number, spread: number): number[] {
  const c = Math.round(mean);
  const lines: number[] = [];
  for (let l = c - spread - 0.5; l <= c + spread + 0.5; l += 1) if (l >= 0.5) lines.push(l);
  return lines;
}

const METRIC_META: Record<string, { group: MarketGroup; unit: string; label: string }> = {
  fouls: { group: "Faul", unit: "faul", label: "Faul" },
  corners: { group: "Korner", unit: "korner", label: "Korner" },
  yellow: { group: "Kart", unit: "sarı kart", label: "Sarı Kart" },
  shots: { group: "Şut", unit: "şut", label: "Şut" },
  sot: { group: "Şut", unit: "isabetli şut", label: "İsabetli Şut" },
  offsides: { group: "Ofsayt", unit: "ofsayt", label: "Ofsayt" },
};

function teamSamples(est: Estimate, metric: Metric): Sample[] {
  return [
    ...est.aWeighted.map((x) => ({ v: valueFor(x.m, metric)!, w: x.w, top: x.top })),
    ...est.bWeighted.map((x) => ({ v: valueAgainst(x.m, metric)!, w: x.w, top: x.top })),
  ];
}

function totalSamples(ds: Dataset, A: TeamInfo, B: TeamInfo, metric: Metric, now: number): Sample[] {
  const both = (m: TeamMatch) => valueFor(m, metric) !== undefined && valueAgainst(m, metric) !== undefined;
  const aW = weightMatches(ds, A, B, metric, true, now, both);
  const bW = weightMatches(ds, B, A, metric, false, now, both);
  return [...aW, ...bW].map((x) => ({
    v: valueFor(x.m, metric)! + valueAgainst(x.m, metric)!,
    w: x.w,
    top: x.top,
  }));
}

function summarize(ds: Dataset, t: TeamInfo): TeamSummary {
  const ms = t.matches;
  const wins = ms.filter((m) => m.gf > m.ga).length;
  const draws = ms.filter((m) => m.gf === m.ga).length;
  const avg: TeamSummary["avg"] = {};
  for (const metric of ["goals", ...COUNT_METRICS] as Metric[]) {
    const f = ms.map((m) => valueFor(m, metric)).filter((v): v is number => v !== undefined);
    const a = ms.map((m) => valueAgainst(m, metric)).filter((v): v is number => v !== undefined);
    if (f.length) {
      avg[metric] = {
        for: Math.round((f.reduce((x, y) => x + y, 0) / f.length) * 100) / 100,
        against: a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 100) / 100 : 0,
      };
    }
  }
  return {
    id: t.id,
    name: t.name,
    logo: t.logo,
    domesticLeague: leagueName(t.domesticLeague),
    played: ms.length,
    wins,
    draws,
    losses: ms.length - wins - draws,
    gfPerMatch: ms.length ? Math.round((ms.reduce((s, m) => s + m.gf, 0) / ms.length) * 100) / 100 : 0,
    gaPerMatch: ms.length ? Math.round((ms.reduce((s, m) => s + m.ga, 0) / ms.length) * 100) / 100 : 0,
    form: ms
      .slice(-5)
      .reverse()
      .map((m) => (m.gf > m.ga ? "G" : m.gf === m.ga ? "B" : "M")),
    avg,
  };
}

function similarList(ds: Dataset, team: TeamInfo, target: TeamInfo): SimilarMatch[] {
  return team.matches
    .map((m) => ({ m, sim: similarity(ds, m.oppId, target.id) }))
    .sort((a, b) => b.sim - a.sim)
    .slice(0, 10)
    .map(({ m, sim }) => {
      const values: SimilarMatch["values"] = {};
      for (const metric of COUNT_METRICS) {
        const f = valueFor(m, metric);
        const a = valueAgainst(m, metric);
        if (f !== undefined || a !== undefined) values[metric] = { for: f, against: a };
      }
      return {
        fixtureId: m.fixtureId,
        date: m.date,
        competition: leagueById(m.leagueId)?.name ?? String(m.leagueId),
        isHome: m.isHome,
        opponent: m.oppName,
        similarity: Math.round(sim * 100),
        score: `${m.gf}-${m.ga}`,
        values,
      };
    });
}

export interface AnalyzeOptions {
  fixtureId?: number;
  leagueId?: number;
  referee?: string;
  missingPlayerIds?: number[];
}

export function analyzeMatch(homeId: number, awayId: number, opts: AnalyzeOptions = {}): AnalysisResult {
  const ds = getDataset();
  const H = ds.teams.get(homeId);
  const A = ds.teams.get(awayId);
  if (!H || !A) throw new Error("Takım bulunamadı. Önce verileri senkronize edin.");
  const now = Date.now();
  const warnings: string[] = [];

  const fx = opts.fixtureId ? ds.fixtures[opts.fixtureId] : undefined;
  let compId = opts.leagueId ?? fx?.leagueId;
  if (!compId) {
    compId = H.domesticLeague !== undefined && H.domesticLeague === A.domesticLeague ? H.domesticLeague : 2;
  }
  const refereeName = opts.referee ?? fx?.referee;

  // Oyuncu profilleri ve taktiksel reaksiyon çarpanları
  const missingPlayerIds = opts.missingPlayerIds ?? [];
  const missingSet = new Set(missingPlayerIds);
  const homePlayers = buildTeamPlayers(H, missingSet);
  const awayPlayers = buildTeamPlayers(A, missingSet);
  const react = computeReactionsAndPlayerImpact(ds, H, A, homePlayers, awayPlayers);

  // Hakem etkisi
  let referee: RefereeInfo | undefined;
  let refFouls = 1;
  let refYellow = 1;
  if (refereeName) {
    const r = ds.referees.get(refereeName.toLowerCase());
    if (r && r.matches >= 2) {
      const fm = r.foulsRel.length ? r.foulsRel.reduce((a, b) => a + b, 0) / r.foulsRel.length : 1;
      const ym = r.yellowRel.length ? r.yellowRel.reduce((a, b) => a + b, 0) / r.yellowRel.length : 1;
      refFouls = shrink(fm, r.foulsRel.length, 1, 6);
      refYellow = shrink(ym, r.yellowRel.length, 1, 6);
      referee = {
        name: r.name,
        matches: r.matches,
        foulsFactor: Math.round(refFouls * 100) / 100,
        yellowFactor: Math.round(refYellow * 100) / 100,
      };
    } else {
      referee = { name: refereeName, matches: r?.matches ?? 0, foulsFactor: 1, yellowFactor: 1 };
    }
  }

  const families: CountFamily[] = [];
  const expected: AnalysisResult["expected"] = {};

  // --- Goller (Dixon-Coles) ---
  const gH = estimateTeamMetric(ds, H, A, "goals", true, compId, now);
  const gA = estimateTeamMetric(ds, A, H, "goals", false, compId, now);
  const lh = (gH?.lambda ?? 1.4) * (react.home.goals ?? 1);
  const la = (gA?.lambda ?? 1.1) * (react.away.goals ?? 1);
  expected.goals = { home: round2(lh), away: round2(la) };
  const mtx = scoreMatrix(lh, la);
  const maxG = mtx.length - 1;
  const homePmf = new Array(maxG + 1).fill(0);
  const awayPmf = new Array(maxG + 1).fill(0);
  const totalPmf = new Array(2 * maxG + 1).fill(0);
  let pH = 0;
  let pD = 0;
  let pA = 0;
  let pBtts = 0;
  const scores: Array<{ home: number; away: number; p: number }> = [];
  for (let h = 0; h <= maxG; h++) {
    for (let a = 0; a <= maxG; a++) {
      const p = mtx[h][a];
      homePmf[h] += p;
      awayPmf[a] += p;
      totalPmf[h + a] += p;
      if (h > a) pH += p;
      else if (h === a) pD += p;
      else pA += p;
      if (h > 0 && a > 0) pBtts += p;
      scores.push({ home: h, away: a, p });
    }
  }
  scores.sort((x, y) => y.p - x.p);

  const goalTotalSamples = totalSamples(ds, H, A, "goals", now);
  families.push({
    key: "goals:total",
    group: "Goller",
    period: "ft",
    label: "MS Toplam Gol",
    unit: "gol",
    mean: round2(lh + la),
    pmf: totalPmf,
    samples: goalTotalSamples,
    lines: [0.5, 1.5, 2.5, 3.5, 4.5, 5.5],
  });
  if (gH) {
    families.push({
      key: "goals:home",
      group: "Goller",
      period: "ft",
      label: `MS ${H.name} Gol`,
      unit: "gol",
      mean: round2(lh),
      pmf: homePmf,
      samples: teamSamples(gH, "goals"),
      lines: [0.5, 1.5, 2.5, 3.5],
    });
  }
  if (gA) {
    families.push({
      key: "goals:away",
      group: "Goller",
      period: "ft",
      label: `MS ${A.name} Gol`,
      unit: "gol",
      mean: round2(la),
      pmf: awayPmf,
      samples: teamSamples(gA, "goals"),
      lines: [0.5, 1.5, 2.5, 3.5],
    });
  }

  // --- İlk yarı ---
  const htH = estimateTeamMetric(ds, H, A, "htGoals", true, compId, now);
  const htA = estimateTeamMetric(ds, A, H, "htGoals", false, compId, now);
  const lhH = Math.min(lh * 0.72, (htH?.lambda ?? lh * 0.44) * (react.home.goals ?? 1));
  const laH = Math.min(la * 0.72, (htA?.lambda ?? la * 0.44) * (react.away.goals ?? 1));
  expected.htGoals = { home: round2(lhH), away: round2(laH) };
  const htM = scoreMatrix(lhH, laH, 6, -0.03);
  let htHome = 0;
  let htDraw = 0;
  let htAway = 0;
  let htBtts = 0;
  const htHomePmf = new Array(7).fill(0);
  const htAwayPmf = new Array(7).fill(0);
  const htTotal = new Array(13).fill(0);
  for (let h = 0; h <= 6; h++)
    for (let a = 0; a <= 6; a++) {
      const p = htM[h][a];
      htHomePmf[h] += p;
      htAwayPmf[a] += p;
      htTotal[h + a] += p;
      if (h > a) htHome += p;
      else if (h === a) htDraw += p;
      else htAway += p;
      if (h > 0 && a > 0) htBtts += p;
    }

  // İY / MS kombinasyonları (1. yarı + bağımsız 2. yarı gol matrisi)
  const shM = scoreMatrix(Math.max(0.08, lh - lhH), Math.max(0.08, la - laH), 6, -0.03);
  const htft: Record<string, number> = { "1/1": 0, "X/1": 0, "X/X": 0, "X/2": 0, "2/2": 0 };
  for (let h1 = 0; h1 <= 6; h1++) {
    for (let a1 = 0; a1 <= 6; a1++) {
      const p1 = htM[h1][a1];
      if (p1 < 1e-6) continue;
      const r1 = h1 > a1 ? "1" : h1 === a1 ? "X" : "2";
      for (let h2 = 0; h2 <= 6; h2++) {
        for (let a2 = 0; a2 <= 6; a2++) {
          const p2 = shM[h2][a2];
          if (p2 < 1e-6) continue;
          const ftH = h1 + h2;
          const ftA = a1 + a2;
          const rF = ftH > ftA ? "1" : ftH === ftA ? "X" : "2";
          const k = `${r1}/${rF}`;
          if (k in htft) htft[k] += p1 * p2;
        }
      }
    }
  }

  families.push({
    key: "htGoals:total",
    group: "Goller",
    period: "ht",
    label: "İY Toplam Gol",
    unit: "gol",
    mean: round2(lhH + laH),
    pmf: htTotal,
    samples: totalSamples(ds, H, A, "htGoals", now),
    lines: [0.5, 1.5, 2.5],
  });
  if (htH) {
    families.push({
      key: "htGoals:home",
      group: "Goller",
      period: "ht",
      label: `İY ${H.name} Gol`,
      unit: "gol",
      mean: round2(lhH),
      pmf: htHomePmf,
      samples: teamSamples(htH, "htGoals"),
      lines: [0.5, 1.5],
    });
  }
  if (htA) {
    families.push({
      key: "htGoals:away",
      group: "Goller",
      period: "ht",
      label: `İY ${A.name} Gol`,
      unit: "gol",
      mean: round2(laH),
      pmf: htAwayPmf,
      samples: teamSamples(htA, "htGoals"),
      lines: [0.5, 1.5],
    });
  }

  // --- Sayısal istatistik pazarları (faul, korner, kart, şut, isabetli şut, ofsayt) — HEM MS HEM İY ---
  const HT_SHARE: Record<string, number> = {
    shots: 0.46,
    sot: 0.46,
    fouls: 0.48,
    corners: 0.47,
    yellow: 0.37,
    offsides: 0.48,
  };

  for (const metric of COUNT_METRICS) {
    const eH = estimateTeamMetric(ds, H, A, metric, true, compId, now);
    const eA = estimateTeamMetric(ds, A, H, metric, false, compId, now);
    if (!eH || !eA || eH.aWeighted.length + eH.bWeighted.length < 3) {
      warnings.push(`${METRIC_META[metric].label} için yeterli maç istatistiği yok.`);
      continue;
    }
    const refFactor = metric === "fouls" ? refFouls : metric === "yellow" ? refYellow : 1;
    const mH = eH.lambda * refFactor * (react.home[metric] ?? 1);
    const mA = eA.lambda * refFactor * (react.away[metric] ?? 1);
    expected[metric] = { home: round2(mH), away: round2(mA) };
    const r = ds.dispersion[metric] ?? 1000;
    const pmfH = negBinPmf(mH, r, Math.ceil(mH * 3 + 15));
    const pmfA = negBinPmf(mA, r, Math.ceil(mA * 3 + 15));
    const meta = METRIC_META[metric];
    const spread = metric === "offsides" || metric === "yellow" ? 2 : 3;

    // Maç Sonucu (MS)
    families.push({
      key: `${metric}:home`,
      group: meta.group,
      period: "ft",
      label: `MS ${H.name} ${meta.label}`,
      unit: meta.unit,
      mean: round2(mH),
      pmf: pmfH,
      samples: teamSamples(eH, metric),
      lines: makeLines(mH, spread),
    });
    families.push({
      key: `${metric}:away`,
      group: meta.group,
      period: "ft",
      label: `MS ${A.name} ${meta.label}`,
      unit: meta.unit,
      mean: round2(mA),
      pmf: pmfA,
      samples: teamSamples(eA, metric),
      lines: makeLines(mA, spread),
    });
    families.push({
      key: `${metric}:total`,
      group: meta.group,
      period: "ft",
      label: `MS Toplam ${meta.label}`,
      unit: meta.unit,
      mean: round2(mH + mA),
      pmf: convolve(pmfH, pmfA),
      samples: totalSamples(ds, H, A, metric, now),
      lines: makeLines(mH + mA, spread + 1),
    });

    // İlk Yarı (İY) — her metrik için Ev, Deplasman ve Toplam
    const share = HT_SHARE[metric] ?? 0.47;
    const hmH = mH * share;
    const hmA = mA * share;
    const hPmfH = negBinPmf(hmH, r, Math.ceil(hmH * 3 + 10));
    const hPmfA = negBinPmf(hmA, r, Math.ceil(hmA * 3 + 10));
    const htSpread = metric === "yellow" || metric === "offsides" || metric === "sot" ? 1 : 2;

    families.push({
      key: `ht_${metric}:home`,
      group: meta.group,
      period: "ht",
      label: `İY ${H.name} ${meta.label}`,
      unit: meta.unit,
      mean: round2(hmH),
      pmf: hPmfH,
      samples: [],
      lines: makeLines(hmH, htSpread),
    });
    families.push({
      key: `ht_${metric}:away`,
      group: meta.group,
      period: "ht",
      label: `İY ${A.name} ${meta.label}`,
      unit: meta.unit,
      mean: round2(hmA),
      pmf: hPmfA,
      samples: [],
      lines: makeLines(hmA, htSpread),
    });
    families.push({
      key: `ht_${metric}:total`,
      group: meta.group,
      period: "ht",
      label: `İY Toplam ${meta.label}`,
      unit: meta.unit,
      mean: round2(hmH + hmA),
      pmf: convolve(hPmfH, hPmfA),
      samples: [],
      lines: makeLines(hmH + hmA, htSpread + 1),
    });
  }

  // --- Sonuç pazarları ---
  const resH = weightMatches(ds, H, A, "goals", true, now, () => true);
  const resA = weightMatches(ds, A, H, "goals", false, now, () => true);
  const outcomeSamples = (hHit: (m: TeamMatch) => boolean, aHit: (m: TeamMatch) => boolean) => [
    ...resH.map((x) => ({ hit: hHit(x.m), w: x.w, top: x.top })),
    ...resA.map((x) => ({ hit: aHit(x.m), w: x.w, top: x.top })),
  ];
  const htOk = (m: TeamMatch) => m.htf !== null && m.hta !== null;
  const htSamples = (hHit: (m: TeamMatch) => boolean, aHit: (m: TeamMatch) => boolean) => [
    ...resH.filter((x) => htOk(x.m)).map((x) => ({ hit: hHit(x.m), w: x.w, top: x.top })),
    ...resA.filter((x) => htOk(x.m)).map((x) => ({ hit: aHit(x.m), w: x.w, top: x.top })),
  ];

  const outcomes: OutcomeSelection[] = [
    {
      key: "ms:1",
      group: "Maç Sonucu",
      period: "ft",
      market: "Maç Sonucu",
      label: `MS 1 (${H.name} kazanır)`,
      probability: pH,
      samples: outcomeSamples((m) => m.gf > m.ga, (m) => m.gf < m.ga),
    },
    {
      key: "ms:x",
      group: "Maç Sonucu",
      period: "ft",
      market: "Maç Sonucu",
      label: "MS X (Beraberlik)",
      probability: pD,
      samples: outcomeSamples((m) => m.gf === m.ga, (m) => m.gf === m.ga),
    },
    {
      key: "ms:2",
      group: "Maç Sonucu",
      period: "ft",
      market: "Maç Sonucu",
      label: `MS 2 (${A.name} kazanır)`,
      probability: pA,
      samples: outcomeSamples((m) => m.gf < m.ga, (m) => m.gf > m.ga),
    },
    {
      key: "cs:1x",
      group: "Maç Sonucu",
      period: "ft",
      market: "Çifte Şans",
      label: `ÇŞ 1-X (${H.name} kaybetmez)`,
      probability: pH + pD,
      samples: outcomeSamples((m) => m.gf >= m.ga, (m) => m.gf <= m.ga),
    },
    {
      key: "cs:x2",
      group: "Maç Sonucu",
      period: "ft",
      market: "Çifte Şans",
      label: `ÇŞ X-2 (${A.name} kaybetmez)`,
      probability: pA + pD,
      samples: outcomeSamples((m) => m.gf <= m.ga, (m) => m.gf >= m.ga),
    },
    {
      key: "cs:12",
      group: "Maç Sonucu",
      period: "ft",
      market: "Çifte Şans",
      label: "ÇŞ 1-2 (Beraberlik olmaz)",
      probability: pH + pA,
      samples: outcomeSamples((m) => m.gf !== m.ga, (m) => m.gf !== m.ga),
    },
    {
      key: "kg:var",
      group: "Goller",
      period: "ft",
      market: "Karşılıklı Gol",
      label: "MS KG Var",
      probability: pBtts,
      samples: outcomeSamples((m) => m.gf > 0 && m.ga > 0, (m) => m.gf > 0 && m.ga > 0),
    },
    {
      key: "kg:yok",
      group: "Goller",
      period: "ft",
      market: "Karşılıklı Gol",
      label: "MS KG Yok",
      probability: 1 - pBtts,
      samples: outcomeSamples((m) => m.gf === 0 || m.ga === 0, (m) => m.gf === 0 || m.ga === 0),
    },
    {
      key: "iy:1",
      group: "Maç Sonucu",
      period: "ht",
      market: "İlk Yarı Sonucu",
      label: `İY 1 (${H.name} önde)`,
      probability: htHome,
      samples: htSamples((m) => m.htf! > m.hta!, (m) => m.htf! < m.hta!),
    },
    {
      key: "iy:x",
      group: "Maç Sonucu",
      period: "ht",
      market: "İlk Yarı Sonucu",
      label: "İY X (Beraberlik)",
      probability: htDraw,
      samples: htSamples((m) => m.htf === m.hta, (m) => m.htf === m.hta),
    },
    {
      key: "iy:2",
      group: "Maç Sonucu",
      period: "ht",
      market: "İlk Yarı Sonucu",
      label: `İY 2 (${A.name} önde)`,
      probability: htAway,
      samples: htSamples((m) => m.htf! < m.hta!, (m) => m.htf! > m.hta!),
    },
    {
      key: "iycs:1x",
      group: "Maç Sonucu",
      period: "ht",
      market: "İlk Yarı Çifte Şans",
      label: `İY 1-X (${H.name} geride bitirmez)`,
      probability: htHome + htDraw,
      samples: htSamples((m) => m.htf! >= m.hta!, (m) => m.htf! <= m.hta!),
    },
    {
      key: "iycs:x2",
      group: "Maç Sonucu",
      period: "ht",
      market: "İlk Yarı Çifte Şans",
      label: `İY X-2 (${A.name} geride bitirmez)`,
      probability: htAway + htDraw,
      samples: htSamples((m) => m.htf! <= m.hta!, (m) => m.htf! >= m.hta!),
    },
    {
      key: "iycs:12",
      group: "Maç Sonucu",
      period: "ht",
      market: "İlk Yarı Çifte Şans",
      label: "İY 1-2 (İlk yarı beraberlik olmaz)",
      probability: htHome + htAway,
      samples: htSamples((m) => m.htf !== m.hta, (m) => m.htf !== m.hta),
    },
    {
      key: "iykg:var",
      group: "Goller",
      period: "ht",
      market: "İlk Yarı KG",
      label: "İY KG Var",
      probability: htBtts,
      samples: htSamples((m) => m.htf! > 0 && m.hta! > 0, (m) => m.htf! > 0 && m.hta! > 0),
    },
    {
      key: "iykg:yok",
      group: "Goller",
      period: "ht",
      market: "İlk Yarı KG",
      label: "İY KG Yok",
      probability: 1 - htBtts,
      samples: htSamples((m) => m.htf === 0 || m.hta === 0, (m) => m.htf === 0 || m.hta === 0),
    },
    {
      key: "iyms:11",
      group: "Maç Sonucu",
      period: "ht",
      market: "İY / MS",
      label: `İY/MS 1/1 (${H.name} / ${H.name})`,
      probability: htft["1/1"],
      samples: htSamples((m) => m.htf! > m.hta! && m.gf > m.ga, (m) => m.htf! < m.hta! && m.gf < m.ga),
    },
    {
      key: "iyms:x1",
      group: "Maç Sonucu",
      period: "ht",
      market: "İY / MS",
      label: `İY/MS X/1 (Beraberlik / ${H.name})`,
      probability: htft["X/1"],
      samples: htSamples((m) => m.htf === m.hta && m.gf > m.ga, (m) => m.htf === m.hta && m.gf < m.ga),
    },
    {
      key: "iyms:xx",
      group: "Maç Sonucu",
      period: "ht",
      market: "İY / MS",
      label: "İY/MS X/X (Beraberlik / Beraberlik)",
      probability: htft["X/X"],
      samples: htSamples((m) => m.htf === m.hta && m.gf === m.ga, (m) => m.htf === m.hta && m.gf === m.ga),
    },
    {
      key: "iyms:x2",
      group: "Maç Sonucu",
      period: "ht",
      market: "İY / MS",
      label: `İY/MS X/2 (Beraberlik / ${A.name})`,
      probability: htft["X/2"],
      samples: htSamples((m) => m.htf === m.hta && m.gf < m.ga, (m) => m.htf === m.hta && m.gf > m.ga),
    },
    {
      key: "iyms:22",
      group: "Maç Sonucu",
      period: "ht",
      market: "İY / MS",
      label: `İY/MS 2/2 (${A.name} / ${A.name})`,
      probability: htft["2/2"],
      samples: htSamples((m) => m.htf! < m.hta! && m.gf < m.ga, (m) => m.htf! > m.hta! && m.gf > m.ga),
    },
  ];

  const hp = ds.profiles.get(H.id);
  const ap = ds.profiles.get(A.id);
  if (!hp || hp.statMatches < 5) warnings.push(`${H.name} için detaylı istatistikli maç sayısı az (${hp?.statMatches ?? 0}).`);
  if (!ap || ap.statMatches < 5) warnings.push(`${A.name} için detaylı istatistikli maç sayısı az (${ap?.statMatches ?? 0}).`);
  if (isEuropeLeague(compId) && (ds.norms.get(compId)?.fouls?.nHome ?? 0) < 30) {
    warnings.push("Bu Avrupa kupası için az veri var; iki takımın lig ortalamaları baz alındı.");
  }

  return {
    home: summarize(ds, H),
    away: summarize(ds, A),
    competition: { id: compId, name: leagueById(compId)?.name ?? String(compId) },
    kickoff: fx?.date,
    referee,
    expected,
    topScores: scores.slice(0, 8).map((s) => ({ ...s, p: Math.round(s.p * 1000) / 10 })),
    families,
    outcomes,
    topPicks: rankTopPicks(families, outcomes),
    similar: { home: similarList(ds, H, A), away: similarList(ds, A, H) },
    profiles: { home: profileView(ds, H.id), away: profileView(ds, A.id) },
    reactions: react.reactions,
    players: { home: homePlayers, away: awayPlayers },
    missingPlayerIds,
    warnings,
    generatedAt: new Date().toISOString(),
  };
}

function round2(v: number) {
  return Math.round(v * 100) / 100;
}

export { poissonPmf };
