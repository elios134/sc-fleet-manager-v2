// Liste des missions (logique pure, testée) : filtres, tri et compteurs des puces.
import type { ListFilter, MissionListItem, SortOrder } from "../helpers";

export type MissionFilters = {
  q: string;
  factions: string[];
  listFilter: ListFilter;
  objectives: Set<string>;
  favorites: Set<string>;
};

/** Missions publiées qui passent les filtres : puce (loot, objectifs, favoris), recherche sur le
 *  titre ou la faction (sans casse), factions choisies. */
export function filterMissions(missions: MissionListItem[], f: MissionFilters): MissionListItem[] {
  const q = f.q.trim().toLowerCase();
  return missions.filter((m) => {
    if (!m.released) return false;
    if (f.listFilter === "objectives" && !f.objectives.has(m.uuid)) return false;
    if (f.listFilter === "favorites" && !f.favorites.has(m.uuid)) return false;
    if (f.listFilter === "loot" && !m.hasBlueprints) return false;
    if (q && !(m.title.toLowerCase().includes(q) || (m.factionName?.toLowerCase().includes(q) ?? false))) return false;
    if (f.factions.length > 0 && !(m.factionName != null && f.factions.includes(m.factionName))) return false;
    return true;
  });
}

/** Tri : réputation décroissante, durée croissante (valeur inconnue en dernier) ou A→Z. */
export function sortMissions(list: MissionListItem[], order: SortOrder): MissionListItem[] {
  const out = [...list];
  if (order === "rep_desc") out.sort((a, b) => (b.reputationAmount ?? -Infinity) - (a.reputationAmount ?? -Infinity));
  else if (order === "duration_asc") out.sort((a, b) => (a.timeMins ?? Infinity) - (b.timeMins ?? Infinity));
  else out.sort((a, b) => a.title.localeCompare(b.title));
  return out;
}

/** Compteurs des puces et du bandeau : missions publiées, avec loot, objectifs, favoris, factions. */
export function missionCounts(missions: MissionListItem[], objectives: Set<string>, favorites: Set<string>) {
  const pub = missions.filter((m) => m.released);
  return {
    all: pub.length,
    loot: pub.filter((m) => m.hasBlueprints).length,
    objectives: objectives.size,
    favorites: favorites.size,
    factions: new Set(pub.map((m) => m.factionName).filter(Boolean)).size,
  };
}
