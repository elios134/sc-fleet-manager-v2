// Résout un nom de lieu (zone Game.log) → système + planète/lune, via les corps de la carte.
export type BodyRef = { name: string; system: string; parentBody: string | null; navIcon: string };

// Planètes de Stanton : par numéro (StantonN) et par code de station (RR_<code>_LEO).
const ALIAS: Record<string, string> = {
  stanton1: "hurston", stanton2: "crusader", stanton3: "arccorp", stanton4: "microtech",
  hur: "hurston", cru: "crusader", arc: "arccorp", mic: "microtech",
};

// Stations orbitales basses (LEO) de Stanton, telles que nommées dans le jeu.
const STATIONS: Record<string, string> = {
  RR_HUR_LEO: "Everus Harbor", RR_CRU_LEO: "Seraphim Station",
  RR_ARC_LEO: "Baijini Point", RR_MIC_LEO: "Port Tressler",
};

/** Nom lisible d'un code de lieu du journal (« Stanton4_NewBabbage » → « New Babbage »). */
export function placeLabel(nom: string): string {
  if (STATIONS[nom]) return STATIONS[nom];
  const m = /^Stanton\d_([A-Za-z0-9]+)$/.exec(nom);
  return m ? m[1].replace(/([a-z])([A-Z])/g, "$1 $2") : nom;
}

const key = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

export function resolveScope(
  lieuNom: string | null,
  bodies: BodyRef[],
): { system: string | null; planet: string | null } {
  if (!lieuNom) return { system: null, planet: null };
  // Codes des journaux actuels (« Stanton4_NewBabbage », « RR_CRU_LEO ») → nom de planète.
  const segs = lieuNom.split(/[_\s]+/).map(key).filter(Boolean).map((s) => ALIAS[s] ?? s);
  // On ignore les étoiles (souvent nommées comme le système → masqueraient la planète),
  // et on retient le corps dont le nom apparaît le PLUS TARD dans le nom de lieu (le plus
  // spécifique : « Stanton_microTech_… » → microTech, pas l'étoile Stanton).
  let hit: BodyRef | null = null;
  let bestIdx = -1;
  for (const b of bodies) {
    if (b.navIcon === "Star") continue;
    const idx = segs.lastIndexOf(key(b.name));
    if (idx > bestIdx) { bestIdx = idx; hit = b; }
  }
  if (!hit) return { system: null, planet: null };
  return { system: hit.system, planet: hit.name };
}
