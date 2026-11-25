export interface LeagueDef {
  id: number;
  name: string;
  country: string;
  type: "league" | "europe";
  espnSlug: string;
}

/** Takip edilen büyük ligler ve Avrupa kupaları */
export const ALL_LEAGUES: LeagueDef[] = [
  { id: 39, name: "Premier League", country: "İngiltere", type: "league", espnSlug: "eng.1" },
  { id: 140, name: "LaLiga", country: "İspanya", type: "league", espnSlug: "esp.1" },
  { id: 135, name: "Serie A", country: "İtalya", type: "league", espnSlug: "ita.1" },
  { id: 78, name: "Bundesliga", country: "Almanya", type: "league", espnSlug: "ger.1" },
  { id: 61, name: "Ligue 1", country: "Fransa", type: "league", espnSlug: "fra.1" },
  { id: 203, name: "Süper Lig", country: "Türkiye", type: "league", espnSlug: "tur.1" },
  { id: 88, name: "Eredivisie", country: "Hollanda", type: "league", espnSlug: "ned.1" },
  { id: 94, name: "Primeira Liga", country: "Portekiz", type: "league", espnSlug: "por.1" },
  { id: 2, name: "Şampiyonlar Ligi", country: "Avrupa", type: "europe", espnSlug: "uefa.champions" },
  { id: 3, name: "Avrupa Ligi", country: "Avrupa", type: "europe", espnSlug: "uefa.europa" },
];

export const DEFAULT_LEAGUE_IDS = ALL_LEAGUES.map((l) => l.id);

export function leagueById(id: number): LeagueDef | undefined {
  return ALL_LEAGUES.find((l) => l.id === id);
}

export function isEuropeLeague(id: number): boolean {
  return leagueById(id)?.type === "europe";
}

/** 2026-27 sezonu için 2026 döner (Temmuz ve sonrası yeni sezon). */
export function currentSeason(now = new Date()): number {
  return now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
}
