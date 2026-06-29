// Filtre + tri des missions (logique pure extraite de MissionIntelPage pour être
// testable isolément). Générique sur la forme : n'importe quel objet portant ces
// champs convient (le type complet MissionListItem reste dans la page).

export type MissionSortOrder = "rep_desc" | "duration_asc" | "title_asc" | (string & {});

export type FilterableMission = {
  released: boolean;
  title: string;
  factionName: string | null;
  reputationAmount: number | null;
  timeMins: number | null;
};

/** Missions publiées, filtrées par recherche (titre/faction) + factions sélectionnées,
    triées selon `sortOrder` (réputation desc / durée asc / titre par défaut). Pur. */
export function filterSortMissions<T extends FilterableMission>(
  missions: T[],
  search: string,
  selectedFactions: string[],
  sortOrder: MissionSortOrder,
): T[] {
  let list = missions.filter((m) => m.released);

  if (search) {
    const q = search.toLowerCase();
    list = list.filter(
      (m) => m.title.toLowerCase().includes(q) || (m.factionName?.toLowerCase().includes(q) ?? false),
    );
  }
  if (selectedFactions.length > 0) {
    list = list.filter((m) => m.factionName != null && selectedFactions.includes(m.factionName));
  }

  const sorted = [...list];
  if (sortOrder === "rep_desc") {
    sorted.sort((a, b) => (b.reputationAmount ?? -Infinity) - (a.reputationAmount ?? -Infinity));
  } else if (sortOrder === "duration_asc") {
    sorted.sort((a, b) => (a.timeMins ?? Infinity) - (b.timeMins ?? Infinity));
  } else {
    sorted.sort((a, b) => a.title.localeCompare(b.title));
  }
  return sorted;
}
