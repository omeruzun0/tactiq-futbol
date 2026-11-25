import { isEuropeLeague, leagueById } from "./leagues";
import { FINISHED, PlayerMatchStat, StoreData, TeamStatLine, loadStore } from "./store";
import { FEATURE_LABELS, FeatureKey, Metric, PlayerImpactProfile, ProfileView } from "./types";

export interface TeamMatch {
  fixtureId: number;
  ts: number;
  date: string;
  leagueId: number;
  isHome: boolean;
  teamId: number;
  oppId: number;
  oppName: string;
  gf: number;
  ga: number;
  htf: number | null;
  hta: number | null;
  sf?: TeamStatLine;
  sa?: TeamStatLine;
  players?: PlayerMatchStat[];
  referee?: string;
}

export interface TeamInfo {
  id: number;
  name: string;
  logo?: string;
  leagues: Set<number>;
  domesticLeague?: number;
  matches: TeamMatch[]; // eskiden yeniye
}

interface NormCell {
  home: number;
  away: number;
  nHome: number;
  nAway: number;
}

export interface TeamProfile {
  raw: Partial<Record<FeatureKey, number>>;
  z: Partial<Record<FeatureKey, number>>;
  pct: Partial<Record<FeatureKey, number>>;
  statMatches: number;
}

export interface RefereeAgg {
  name: string;
  matches: number;
  foulsRel: number[];
  yellowRel: number[];
}

export interface Dataset {
  builtFrom: number;
  teams: Map<number, TeamInfo>;
  norms: Map<number, Partial<Record<Metric, NormCell>>>;
  globalNorms: Partial<Record<Metric, NormCell>>;
  dispersion: Partial<Record<Metric, number>>;
  profiles: Map<number, TeamProfile>;
  referees: Map<string, RefereeAgg>;
  fixtures: StoreData["fixtures"];
}

export const COUNT_METRICS: Metric[] = ["shots", "sot", "fouls", "corners", "yellow", "offsides"];
export const ALL_METRICS: Metric[] = ["goals", "htGoals", ...COUNT_METRICS];

export function valueFor(m: TeamMatch, metric: Metric): number | undefined {
  if (metric === "goals") return m.gf;
  if (metric === "htGoals") return m.htf ?? undefined;
  return m.sf?.[metric as keyof TeamStatLine];
}

export function valueAgainst(m: TeamMatch, metric: Metric): number | undefined {
  if (metric === "goals") return m.ga;
  if (metric === "htGoals") return m.hta ?? undefined;
  return m.sa?.[metric as keyof TeamStatLine];
}

type G = typeof globalThis & { __fbDataset?: Dataset };
const g = globalThis as G;

export function getDataset(): Dataset {
  const store = loadStore();
  if (g.__fbDataset && g.__fbDataset.builtFrom === store.updatedAt) return g.__fbDataset;
  const ds = buildDataset(store);
  g.__fbDataset = ds;
  return ds;
}

function mean(a: number[]): number {
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
}

function buildDataset(store: StoreData): Dataset {
  const teams = new Map<number, TeamInfo>();
  const ensureTeam = (id: number, name: string, logo?: string) => {
    let t = teams.get(id);
    if (!t) {
      t = { id, name, logo, leagues: new Set(), matches: [] };
      teams.set(id, t);
    }
    return t;
  };

  const finished = Object.values(store.fixtures)
    .filter((f) => FINISHED.has(f.status) && f.goals.home !== null && f.goals.away !== null)
    .sort((a, b) => a.ts - b.ts);

  for (const f of Object.values(store.fixtures)) {
    ensureTeam(f.home.id, f.home.name, f.home.logo).leagues.add(f.leagueId);
    ensureTeam(f.away.id, f.away.name, f.away.logo).leagues.add(f.leagueId);
  }

  for (const f of finished) {
    const base = { fixtureId: f.id, ts: f.ts, date: f.date, leagueId: f.leagueId, referee: f.referee };
    ensureTeam(f.home.id, f.home.name).matches.push({
      ...base,
      isHome: true,
      teamId: f.home.id,
      oppId: f.away.id,
      oppName: f.away.name,
      gf: f.goals.home!,
      ga: f.goals.away!,
      htf: f.ht.home,
      hta: f.ht.away,
      sf: f.stats?.home,
      sa: f.stats?.away,
      players: f.players?.home,
    });
    ensureTeam(f.away.id, f.away.name).matches.push({
      ...base,
      isHome: false,
      teamId: f.away.id,
      oppId: f.home.id,
      oppName: f.home.name,
      gf: f.goals.away!,
      ga: f.goals.home!,
      htf: f.ht.away,
      hta: f.ht.home,
      sf: f.stats?.away,
      sa: f.stats?.home,
      players: f.players?.away,
    });
  }

  for (const t of teams.values()) {
    const counts = new Map<number, number>();
    for (const l of t.leagues) if (!isEuropeLeague(l)) counts.set(l, 0);
    for (const m of t.matches) if (counts.has(m.leagueId)) counts.set(m.leagueId, counts.get(m.leagueId)! + 1);
    let bestL: number | undefined;
    let bestC = -1;
    for (const [l, c] of counts) if (c > bestC) [bestL, bestC] = [l, c];
    t.domesticLeague = bestL;
  }

  const acc = new Map<number, Partial<Record<Metric, { h: number[]; a: number[] }>>>();
  const gacc: Partial<Record<Metric, { h: number[]; a: number[] }>> = {};
  for (const t of teams.values()) {
    for (const m of t.matches) {
      let la = acc.get(m.leagueId);
      if (!la) acc.set(m.leagueId, (la = {}));
      for (const metric of ALL_METRICS) {
        const v = valueFor(m, metric);
        if (v === undefined) continue;
        const cell = (la[metric] ??= { h: [], a: [] });
        const gcell = (gacc[metric] ??= { h: [], a: [] });
        (m.isHome ? cell.h : cell.a).push(v);
        (m.isHome ? gcell.h : gcell.a).push(v);
      }
    }
  }
  const toCell = (c: { h: number[]; a: number[] }): NormCell => ({
    home: mean(c.h),
    away: mean(c.a),
    nHome: c.h.length,
    nAway: c.a.length,
  });
  const norms = new Map<number, Partial<Record<Metric, NormCell>>>();
  for (const [l, metrics] of acc) {
    const out: Partial<Record<Metric, NormCell>> = {};
    for (const k of Object.keys(metrics) as Metric[]) out[k] = toCell(metrics[k]!);
    norms.set(l, out);
  }
  const globalNorms: Partial<Record<Metric, NormCell>> = {};
  for (const k of Object.keys(gacc) as Metric[]) globalNorms[k] = toCell(gacc[k]!);

  const dispersion: Partial<Record<Metric, number>> = {};
  for (const metric of ALL_METRICS) {
    const mus: number[] = [];
    const excess: number[] = [];
    for (const t of teams.values()) {
      const vals = t.matches.map((m) => valueFor(m, metric)).filter((v): v is number => v !== undefined);
      if (vals.length < 4) continue;
      const mu = mean(vals);
      const v = vals.reduce((s, x) => s + (x - mu) ** 2, 0) / (vals.length - 1);
      mus.push(mu);
      excess.push(v - mu);
    }
    const mu = mean(mus);
    const ex = mean(excess);
    dispersion[metric] = ex > 0.05 ? Math.min(1000, Math.max(3, (mu * mu) / ex)) : 1000;
  }

  const ds: Dataset = {
    builtFrom: store.updatedAt,
    teams,
    norms,
    globalNorms,
    dispersion,
    profiles: new Map(),
    referees: new Map(),
    fixtures: store.fixtures,
  };

  buildProfiles(ds);
  buildReferees(ds);
  return ds;
}

export function getNorm(ds: Dataset, leagueId: number, metric: Metric, isHome: boolean): number {
  const c = ds.norms.get(leagueId)?.[metric];
  const gc = ds.globalNorms[metric];
  const n = c ? (isHome ? c.nHome : c.nAway) : 0;
  if (c && n >= 30) return isHome ? c.home : c.away;
  if (gc) return isHome ? gc.home : gc.away;
  return 1;
}

export function relFor(ds: Dataset, m: TeamMatch, metric: Metric): number | undefined {
  const v = valueFor(m, metric);
  if (v === undefined) return undefined;
  const n = getNorm(ds, m.leagueId, metric, m.isHome);
  return n > 0 ? v / n : undefined;
}

export function relAgainst(ds: Dataset, m: TeamMatch, metric: Metric): number | undefined {
  const v = valueAgainst(m, metric);
  if (v === undefined) return undefined;
  const n = getNorm(ds, m.leagueId, metric, !m.isHome);
  return n > 0 ? v / n : undefined;
}

function buildProfiles(ds: Dataset) {
  const seasonPass = new Map<number, number>();
  for (const t of ds.teams.values()) {
    const vals = t.matches.map((m) => m.sf?.passesPct).filter((v): v is number => v !== undefined);
    if (vals.length >= 2) seasonPass.set(t.id, mean(vals));
  }

  const raws = new Map<number, { raw: Partial<Record<FeatureKey, number>>; statMatches: number }>();
  for (const t of ds.teams.values()) {
    if (!t.matches.length) continue;
    const raw: Partial<Record<FeatureKey, number>> = {};
    const gd = t.matches.map((m) => {
      const gfN = getNorm(ds, m.leagueId, "goals", m.isHome) || 1.3;
      const gaN = getNorm(ds, m.leagueId, "goals", !m.isHome) || 1.3;
      return m.gf / gfN - m.ga / gaN;
    });
    raw.strength = mean(gd);

    const sm = t.matches.filter((m) => m.sf && m.sa);
    if (sm.length >= 2) {
      const col = (fn: (m: TeamMatch) => number | undefined) => {
        const vals = sm.map(fn).filter((v): v is number => v !== undefined && Number.isFinite(v));
        return vals.length >= 2 ? mean(vals) : undefined;
      };
      raw.possession = col((m) => m.sf?.possession);
      raw.passAcc = col((m) => m.sf?.passesPct);
      raw.shotsFor = col((m) => relFor(ds, m, "shots"));
      raw.shotsAgainst = col((m) => relAgainst(ds, m, "shots"));
      raw.foulsCommitted = col((m) => relFor(ds, m, "fouls"));
      raw.foulsDrawn = col((m) => relAgainst(ds, m, "fouls"));
      raw.cornersFor = col((m) => relFor(ds, m, "corners"));
      raw.offsidesCommitted = col((m) => relFor(ds, m, "offsides"));
      raw.offsidesForced = col((m) => relAgainst(ds, m, "offsides"));
      raw.directness = col((m) => {
        const s = relFor(ds, m, "shots");
        const p = m.sf?.possession;
        return s !== undefined && p ? s / Math.max(0.6, p / 50) : undefined;
      });
      raw.press = col((m) => {
        const oppAvg = seasonPass.get(m.oppId);
        const inMatch = m.sa?.passesPct;
        return oppAvg !== undefined && inMatch !== undefined ? oppAvg - inMatch : undefined;
      });
    }
    for (const k of Object.keys(raw) as FeatureKey[]) if (raw[k] === undefined) delete raw[k];
    raws.set(t.id, { raw, statMatches: sm.length });
  }

  const keys = Object.keys(FEATURE_LABELS) as FeatureKey[];
  const stats: Partial<Record<FeatureKey, { mu: number; sd: number; sorted: number[] }>> = {};
  for (const k of keys) {
    const vals = [...raws.values()].map((r) => r.raw[k]).filter((v): v is number => v !== undefined);
    if (vals.length < 4) continue;
    const mu = mean(vals);
    const sd = Math.sqrt(vals.reduce((s, x) => s + (x - mu) ** 2, 0) / vals.length) || 1;
    stats[k] = { mu, sd, sorted: [...vals].sort((a, b) => a - b) };
  }
  for (const [id, r] of raws) {
    const z: Partial<Record<FeatureKey, number>> = {};
    const pct: Partial<Record<FeatureKey, number>> = {};
    for (const k of keys) {
      const v = r.raw[k];
      const st = stats[k];
      if (v === undefined || !st) continue;
      z[k] = (v - st.mu) / st.sd;
      const below = st.sorted.filter((x) => x < v).length;
      const eq = st.sorted.filter((x) => x === v).length;
      pct[k] = Math.round(((below + eq / 2) / st.sorted.length) * 100);
    }
    ds.profiles.set(id, { raw: r.raw, z, pct, statMatches: r.statMatches });
  }
}

function buildReferees(ds: Dataset) {
  const seen = new Set<number>();
  for (const t of ds.teams.values()) {
    for (const m of t.matches) {
      if (!m.referee || seen.has(m.fixtureId) || !m.sf || !m.sa) continue;
      seen.add(m.fixtureId);
      const fouls = (m.sf.fouls ?? NaN) + (m.sa.fouls ?? NaN);
      const yellow = (m.sf.yellow ?? NaN) + (m.sa.yellow ?? NaN);
      const nf = getNorm(ds, m.leagueId, "fouls", true) + getNorm(ds, m.leagueId, "fouls", false);
      const ny = getNorm(ds, m.leagueId, "yellow", true) + getNorm(ds, m.leagueId, "yellow", false);
      const key = m.referee.toLowerCase();
      let r = ds.referees.get(key);
      if (!r) ds.referees.set(key, (r = { name: m.referee, matches: 0, foulsRel: [], yellowRel: [] }));
      r.matches++;
      if (Number.isFinite(fouls) && nf > 0) r.foulsRel.push(fouls / nf);
      if (Number.isFinite(yellow) && ny > 0) r.yellowRel.push(yellow / ny);
    }
  }
}

const BASE_WEIGHTS: Record<FeatureKey, number> = {
  strength: 1.3,
  possession: 1.4,
  passAcc: 1.0,
  press: 0.9,
  directness: 0.9,
  shotsFor: 0.8,
  shotsAgainst: 0.8,
  foulsCommitted: 0.5,
  foulsDrawn: 0.6,
  cornersFor: 0.5,
  offsidesCommitted: 0.4,
  offsidesForced: 0.6,
};

const METRIC_WEIGHTS: Partial<Record<Metric, Partial<Record<FeatureKey, number>>>> = {
  fouls: { foulsDrawn: 2.0, possession: 1.8, passAcc: 1.3, press: 1.0, foulsCommitted: 0.8 },
  yellow: { foulsDrawn: 1.6, possession: 1.4, foulsCommitted: 1.0, strength: 1.2 },
  corners: { cornersFor: 1.2, shotsFor: 1.2, shotsAgainst: 1.2, strength: 1.6, possession: 1.4 },
  shots: { shotsAgainst: 1.2, shotsFor: 1.0, strength: 1.6, possession: 1.4 },
  sot: { shotsAgainst: 1.2, shotsFor: 1.0, strength: 1.6, possession: 1.4 },
  offsides: { offsidesForced: 2.6, directness: 1.5, possession: 1.3, press: 1.0, offsidesCommitted: 0.9 },
  goals: { strength: 2.0, shotsAgainst: 1.0, shotsFor: 1.0 },
  htGoals: { strength: 2.0 },
};

export function similarity(ds: Dataset, aId: number, bId: number, metric?: Metric): number {
  if (aId === bId) return 1;
  const pa = ds.profiles.get(aId);
  const pb = ds.profiles.get(bId);
  if (!pa || !pb) return 0.35;
  const w = { ...BASE_WEIGHTS, ...(metric ? METRIC_WEIGHTS[metric] : {}) };
  let num = 0;
  let den = 0;
  for (const k of Object.keys(w) as FeatureKey[]) {
    const za = pa.z[k];
    const zb = pb.z[k];
    if (za === undefined || zb === undefined) continue;
    num += w[k] * (za - zb) ** 2;
    den += w[k];
  }
  if (den === 0) return 0.35;
  const d2 = num / den;
  return Math.exp(-d2 / (2 * 0.8 * 0.8));
}

export function styleLabel(p?: TeamProfile): string {
  if (!p) return "Veri yetersiz";
  const z = p.z;
  const tags: string[] = [];
  if ((z.possession ?? 0) > 0.8) tags.push("Topa sahip olan");
  else if ((z.possession ?? 0) < -0.8) tags.push("Topu rakibe bırakan");
  if ((z.offsidesForced ?? 0) > 0.85) tags.push("ofsayt tuzağı kuran");
  if ((z.press ?? 0) > 0.7) tags.push("yoğun presli");
  if ((z.directness ?? 0) > 0.8) tags.push("dikine/hızlı");
  if ((z.foulsCommitted ?? 0) > 0.8) tags.push("sert");
  if ((z.shotsAgainst ?? 0) < -0.8) tags.push("savunması sağlam");
  if ((z.cornersFor ?? 0) > 0.8) tags.push("kanat/korner ağırlıklı");
  if ((z.strength ?? 0) > 1) tags.unshift("Güçlü");
  else if ((z.strength ?? 0) < -1) tags.unshift("Zayıf");
  return tags.length ? tags.join(", ") : "Dengeli";
}

export function profileView(ds: Dataset, teamId: number): ProfileView {
  const p = ds.profiles.get(teamId);
  return {
    percentiles: p?.pct ?? {},
    raw: p?.raw ?? {},
    statMatches: p?.statMatches ?? 0,
    styleLabel: styleLabel(p),
  };
}

/** Takımın son maçlarından en belirleyici kilit oyuncuların istatistik profilini çıkarır */
export function buildTeamPlayers(team: TeamInfo, missingSet: Set<number>): PlayerImpactProfile[] {
  const agg = new Map<
    number,
    {
      id: number;
      name: string;
      pos: string;
      app: number;
      starts: number;
      fc: number;
      fs: number;
      yc: number;
      sh: number;
      sot: number;
      g: number;
    }
  >();

  for (const m of team.matches) {
    if (!m.players) continue;
    for (const p of m.players) {
      let cur = agg.get(p.id);
      if (!cur) {
        cur = { id: p.id, name: p.name, pos: p.pos, app: 0, starts: 0, fc: 0, fs: 0, yc: 0, sh: 0, sot: 0, g: 0 };
        agg.set(p.id, cur);
      }
      cur.app++;
      if (p.starter) cur.starts++;
      cur.fc += p.foulsCommitted;
      cur.fs += p.foulsSuffered;
      cur.yc += p.yellow;
      cur.sh += p.shots;
      cur.sot += p.sot;
      cur.g += p.goals;
    }
  }

  const r2 = (v: number) => Math.round(v * 100) / 100;
  const list: PlayerImpactProfile[] = [];
  for (const p of agg.values()) {
    if (p.app < 2) continue;
    const fcPg = p.fc / p.app;
    const fsPg = p.fs / p.app;
    const ycPg = p.yc / p.app;
    const shPg = p.sh / p.app;
    const sotPg = p.sot / p.app;
    const gPg = p.g / p.app;
    const tags: string[] = [];
    if (fsPg >= 1.5) tags.push("Faul mıknatısı");
    if (fcPg >= 1.5) tags.push("Çok faul yapar");
    if (ycPg >= 0.3) tags.push("Kart riski yüksek");
    if (shPg >= 2.2 || gPg >= 0.4) tags.push("Hücum/Şut lideri");
    list.push({
      id: p.id,
      name: p.name,
      position: p.pos,
      appearances: p.app,
      starts: p.starts,
      foulsCommittedPg: r2(fcPg),
      foulsSufferedPg: r2(fsPg),
      yellowPg: r2(ycPg),
      shotsPg: r2(shPg),
      sotPg: r2(sotPg),
      goalsPg: r2(gPg),
      tags,
      missing: missingSet.has(p.id),
    });
  }

  return list
    .sort((a, b) => b.starts - a.starts || b.shotsPg + b.foulsSufferedPg + b.foulsCommittedPg - (a.shotsPg + a.foulsSufferedPg + a.foulsCommittedPg))
    .slice(0, 14);
}

export function leagueName(id?: number): string | undefined {
  return id === undefined ? undefined : leagueById(id)?.name;
}
