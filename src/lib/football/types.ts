// Sunucu ve istemci tarafında ortak kullanılan saf tipler

export type Metric =
  | "goals"
  | "htGoals"
  | "shots"
  | "sot"
  | "fouls"
  | "corners"
  | "yellow"
  | "offsides";

export type FeatureKey =
  | "strength"
  | "possession"
  | "passAcc"
  | "press"
  | "directness"
  | "shotsFor"
  | "shotsAgainst"
  | "foulsCommitted"
  | "foulsDrawn"
  | "cornersFor"
  | "offsidesCommitted"
  | "offsidesForced";

export const FEATURE_LABELS: Record<FeatureKey, string> = {
  strength: "Güç (gol farkı)",
  possession: "Topa sahip olma",
  passAcc: "Pas isabeti",
  press: "Pres yoğunluğu",
  directness: "Dikine oyun",
  shotsFor: "Hücum hacmi (şut)",
  shotsAgainst: "Rakibe verilen şut",
  foulsCommitted: "Faul yapma eğilimi",
  foulsDrawn: "Faul yaptırma",
  cornersFor: "Korner üretimi",
  offsidesCommitted: "Ofsayta düşme",
  offsidesForced: "Ofsayt tuzağı (rakibi düşürme)",
};

export interface ProfileView {
  /** 0-100 yüzdelik dilim (tüm takımlara göre) */
  percentiles: Partial<Record<FeatureKey, number>>;
  raw: Partial<Record<FeatureKey, number>>;
  statMatches: number;
  styleLabel: string;
}

export interface TeamSummary {
  id: number;
  name: string;
  logo?: string;
  domesticLeague?: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  gfPerMatch: number;
  gaPerMatch: number;
  form: string[]; // son 5 ("G","B","M")
  avg: Partial<Record<Metric, { for: number; against: number }>>;
}

export interface SimilarMatch {
  fixtureId: number;
  date: string;
  competition: string;
  isHome: boolean;
  opponent: string;
  similarity: number; // 0-100
  score: string;
  values: Partial<Record<Metric, { for?: number; against?: number }>>;
}

export interface Sample {
  v: number;
  w: number;
  top: boolean;
}

export type MarketGroup =
  | "Maç Sonucu"
  | "Goller"
  | "Faul"
  | "Korner"
  | "Kart"
  | "Şut"
  | "Ofsayt";

export interface CountFamily {
  key: string;
  group: MarketGroup;
  period: "ft" | "ht";
  label: string;
  unit: string;
  mean: number;
  pmf: number[];
  samples: Sample[];
  lines: number[];
}

export interface OutcomeSelection {
  key: string;
  group: MarketGroup;
  period: "ft" | "ht";
  market: string;
  label: string;
  probability: number; // 0-1
  samples: Array<{ hit: boolean; w: number; top: boolean }>;
}

export interface EvaluatedPick {
  key: string;
  group: MarketGroup;
  market: string;
  label: string;
  probability: number; // 0-100
  hitRate: number | null; // ağırlıklı, 0-100
  hitCount: number;
  hitTotal: number;
  confidence: number; // 0-100
  fairOdds: number;
}

export interface RefereeInfo {
  name: string;
  matches: number;
  foulsFactor: number;
  yellowFactor: number;
}

export interface TacticalReaction {
  id: string;
  title: string;
  target: "home" | "away" | "both";
  metric: Metric;
  multiplier: number; // örn. 1.14
  explanation: string;
}

export interface PlayerImpactProfile {
  id: number;
  name: string;
  position: string;
  appearances: number;
  starts: number;
  foulsCommittedPg: number;
  foulsSufferedPg: number;
  yellowPg: number;
  shotsPg: number;
  sotPg: number;
  goalsPg: number;
  /** Oyuncunun en belirgin rol etiketi (örn. "Faul mıknatısı", "Sert müdahale", "Gol/Şut lideri") */
  tags: string[];
  missing?: boolean;
}

export interface AnalysisResult {
  home: TeamSummary;
  away: TeamSummary;
  competition: { id: number; name: string };
  kickoff?: string;
  referee?: RefereeInfo;
  expected: Partial<Record<Metric, { home: number; away: number }>>;
  topScores: Array<{ home: number; away: number; p: number }>;
  families: CountFamily[];
  outcomes: OutcomeSelection[];
  topPicks: EvaluatedPick[];
  similar: { home: SimilarMatch[]; away: SimilarMatch[] };
  profiles: { home: ProfileView; away: ProfileView };
  reactions: TacticalReaction[];
  players: { home: PlayerImpactProfile[]; away: PlayerImpactProfile[] };
  missingPlayerIds: number[];
  warnings: string[];
  generatedAt: string;
}
