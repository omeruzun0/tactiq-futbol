// Saf olasılık fonksiyonları ve bahis değerlendirme (sunucu + istemci)
import { CountFamily, EvaluatedPick, OutcomeSelection, Sample } from "./types";

export function poissonPmf(lambda: number, maxK: number): number[] {
  const out: number[] = [];
  let p = Math.exp(-lambda);
  for (let k = 0; k <= maxK; k++) {
    out.push(p);
    p = (p * lambda) / (k + 1);
  }
  return normalize(out);
}

/** Negatif binom (aşırı yayılım) — r büyüdükçe Poisson'a yaklaşır */
export function negBinPmf(mean: number, r: number, maxK: number): number[] {
  if (r >= 500 || mean <= 0) return poissonPmf(Math.max(mean, 0.01), maxK);
  const q = mean / (r + mean);
  const out: number[] = [];
  let p = Math.pow(r / (r + mean), r);
  for (let k = 0; k <= maxK; k++) {
    out.push(p);
    p = (p * (k + r) * q) / (k + 1);
  }
  return normalize(out);
}

export function convolve(a: number[], b: number[]): number[] {
  const out = new Array(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    if (a[i] < 1e-12) continue;
    for (let j = 0; j < b.length; j++) out[i + j] += a[i] * b[j];
  }
  return normalize(out);
}

function normalize(arr: number[]): number[] {
  const s = arr.reduce((x, y) => x + y, 0) || 1;
  return arr.map((v) => v / s);
}

export function probOver(pmf: number[], line: number): number {
  let p = 0;
  for (let k = 0; k < pmf.length; k++) if (k > line) p += pmf[k];
  return Math.min(1, Math.max(0, p));
}

/** Dixon-Coles düzeltmeli skor matrisi */
export function scoreMatrix(lh: number, la: number, maxGoals = 10, rho = -0.06): number[][] {
  const ph = poissonPmf(lh, maxGoals);
  const pa = poissonPmf(la, maxGoals);
  const m: number[][] = [];
  let total = 0;
  for (let h = 0; h <= maxGoals; h++) {
    m[h] = [];
    for (let a = 0; a <= maxGoals; a++) {
      let tau = 1;
      if (h === 0 && a === 0) tau = 1 - lh * la * rho;
      else if (h === 0 && a === 1) tau = 1 + lh * rho;
      else if (h === 1 && a === 0) tau = 1 + la * rho;
      else if (h === 1 && a === 1) tau = 1 - rho;
      const v = ph[h] * pa[a] * Math.max(tau, 0.01);
      m[h][a] = v;
      total += v;
    }
  }
  for (let h = 0; h <= maxGoals; h++) for (let a = 0; a <= maxGoals; a++) m[h][a] /= total;
  return m;
}

const TRIVIAL_CAP = 0.9; // önerilerde bu olasılığın üstü "çok düşük oranlı" sayılır
const MIN_PICK = 0.6;

function computeConfidence(p: number, hit: number | null, nEff: number): number {
  const sampleConf = Math.min(1, nEff / 8);
  const hitShrunk = hit === null ? p : (nEff * hit + 2 * p) / (nEff + 2);
  const agreement = hit === null ? 0.5 : 1 - Math.min(1, Math.abs(p - hit) * 2);
  return Math.round(100 * (0.6 * p + 0.25 * hitShrunk + 0.08 * sampleConf + 0.07 * agreement));
}

function weightedHit(items: Array<{ hit: boolean; w: number; top: boolean }>) {
  let sw = 0;
  let sw2 = 0;
  let sh = 0;
  let hc = 0;
  let ht = 0;
  for (const it of items) {
    sw += it.w;
    sw2 += it.w * it.w;
    if (it.hit) sh += it.w;
    if (it.top) {
      ht++;
      if (it.hit) hc++;
    }
  }
  return {
    hit: sw > 0 ? sh / sw : null,
    nEff: sw2 > 0 ? (sw * sw) / sw2 : 0,
    hitCount: hc,
    hitTotal: ht,
  };
}

export function fmtLine(line: number): string {
  return line.toFixed(1).replace(".", ",");
}

export function evaluateCountLine(fam: CountFamily, line: number, dir: "over" | "under"): EvaluatedPick {
  const pOver = probOver(fam.pmf, line);
  const p = dir === "over" ? pOver : 1 - pOver;
  const items = fam.samples.map((s: Sample) => ({
    hit: dir === "over" ? s.v > line : s.v < line,
    w: s.w,
    top: s.top,
  }));
  const wh = weightedHit(items);
  return {
    key: `${fam.key}:${line}:${dir}`,
    group: fam.group,
    market: fam.label,
    label: `${fam.label} ${fmtLine(line)} ${dir === "over" ? "Üst" : "Alt"}`,
    probability: Math.round(p * 1000) / 10,
    hitRate: wh.hit === null ? null : Math.round(wh.hit * 1000) / 10,
    hitCount: wh.hitCount,
    hitTotal: wh.hitTotal,
    confidence: computeConfidence(p, wh.hit, wh.nEff),
    fairOdds: p > 0 ? Math.round((1 / p) * 100) / 100 : 99,
  };
}

export function evaluateOutcome(sel: OutcomeSelection): EvaluatedPick {
  const wh = weightedHit(sel.samples);
  const p = sel.probability;
  return {
    key: sel.key,
    group: sel.group,
    market: sel.market,
    label: sel.label,
    probability: Math.round(p * 1000) / 10,
    hitRate: wh.hit === null ? null : Math.round(wh.hit * 1000) / 10,
    hitCount: wh.hitCount,
    hitTotal: wh.hitTotal,
    confidence: computeConfidence(p, wh.hit, wh.nEff),
    fairOdds: p > 0 ? Math.round((1 / p) * 100) / 100 : 99,
  };
}

/** Her pazar ailesinden en güvenilir (ama anlamsız derecede kolay olmayan) seçimi bulur ve sıralar */
export function rankTopPicks(
  families: CountFamily[],
  outcomes: OutcomeSelection[],
  limit = 12
): EvaluatedPick[] {
  const best = new Map<string, EvaluatedPick>();
  const consider = (familyKey: string, pick: EvaluatedPick) => {
    const p = pick.probability / 100;
    if (p < MIN_PICK || p > TRIVIAL_CAP) return;
    const cur = best.get(familyKey);
    if (!cur || pick.confidence > cur.confidence) best.set(familyKey, pick);
  };

  for (const fam of families) {
    for (const line of fam.lines) {
      consider(fam.key, evaluateCountLine(fam, line, "over"));
      consider(fam.key, evaluateCountLine(fam, line, "under"));
    }
  }
  for (const sel of outcomes) {
    consider(sel.market, evaluateOutcome(sel));
  }
  return [...best.values()].sort((a, b) => b.confidence - a.confidence).slice(0, limit);
}
