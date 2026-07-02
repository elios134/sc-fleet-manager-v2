// Données/types partagés de la carte stellaire, indépendants du rendu. Extraits de
// l'ancien StarmapCanvas 2D (supprimé) — utilisés par la vue 3D (Starmap3D) et la carte
// du GPS trading (TripMap3D / TripMapModal).

export type StarmapBodyItem = {
  id: string;
  recordName: string;
  systemName: string;
  navIcon: string;
  name: string;
  description: string | null;
  size: number | null;
  parentRef: string | null;
  hideInStarmap: boolean;
  showOrbitLine: boolean;
  orbitOrder: number | null;
  source: string;
  lastSyncedAt: string | null;
  posX: number | null;
  posY: number | null;
  posZ: number | null;
  wikiUuid: string | null;
  appearance: string | null;
  habitable: number | null;
  distance: number | null;
  longitude: number | null;
  latitude: number | null;
  subtype: string | null;
  affColor: string | null;
};

/** Nom affichable d'un corps (replie sur le stem du recordName si nom technique/vide). */
export function safeName(body: StarmapBodyItem): string {
  const n = body.name;
  if (!n || n.startsWith("@") || n.toLowerCase().includes("uninitialized") || n.toLowerCase().includes("loc_")) {
    return body.recordName.split(".").pop() ?? body.navIcon;
  }
  return n;
}

export const GALAXY_POSITIONS: Record<string, { gx: number; gy: number }> = {
  stanton: { gx: 0, gy: 0 },
  pyro: { gx: 520, gy: -120 },
  nyx: { gx: -360, gy: 300 },
};

export const GALAXY_LINKS: Array<[string, string]> = [
  ["stanton", "pyro"],
  ["stanton", "nyx"],
  ["pyro", "nyx"],
];

export const SYSTEM_COLORS: Record<string, string> = {
  stanton: "#f5a623",
  pyro: "#ff4422",
  nyx: "#28c8f0",
};

export const SYSTEM_NAMES: Record<string, string> = {
  stanton: "STANTON",
  pyro: "PYRO",
  nyx: "NYX",
};
