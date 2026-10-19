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

// ── Géométrie + POI (JSON CDN dérivé des CSV VerseTime, cf. starmap_geometry Rust) ──
export type GeoBody = {
  name: string;
  type: string;
  parentBody: string | null;
  parentStar: string | null;
  coord: [number, number, number];
  bodyRadius: number;
  rotationCorrection: number;
  orbitRadius: number;
  orbitAngle: number;
  themeColor: [number, number, number];
};
export type GeoPoi = {
  name: string;
  type: string;
  parentBody: string;
  coord: [number, number, number];
  wikiLink: string | null;
  /** Marqueur quantum visible en jeu. */
  quantum: boolean;
  /** Lieu privé / caché (pas de marqueur public). */
  hidden: boolean;
};
export type GeoData = { systems: { name: string; star: string }[]; bodies: GeoBody[]; pois: GeoPoi[] };

const geoNum = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const geoVec3 = (v: unknown): [number, number, number] | null => {
  if (!Array.isArray(v) || v.length < 3) return null;
  const a = geoNum(v[0]), b = geoNum(v[1]), c = geoNum(v[2]);
  return a != null && b != null && c != null ? [a, b, c] : null;
};

/** Parse défensif du JSON géométrie : ignore les entrées invalides, ne jette jamais. */
export function parseGeo(raw: unknown): GeoData {
  const o = (raw ?? {}) as Record<string, unknown>;
  const bodiesIn = Array.isArray(o.bodies) ? o.bodies : [];
  const poisIn = Array.isArray(o.pois) ? o.pois : [];
  const systemsIn = Array.isArray(o.systems) ? o.systems : [];
  const bodies: GeoBody[] = [];
  for (const r of bodiesIn as Record<string, unknown>[]) {
    const coord = geoVec3(r.coord);
    const radius = geoNum(r.bodyRadius);
    if (!r.name || typeof r.name !== "string" || !coord || radius == null) continue;
    const tc = geoVec3(r.themeColor) ?? [128, 128, 128];
    bodies.push({
      name: r.name,
      type: String(r.type ?? ""),
      parentBody: (r.parentBody as string) || null,
      parentStar: (r.parentStar as string) || null,
      coord,
      bodyRadius: radius,
      rotationCorrection: geoNum(r.rotationCorrection) ?? 0,
      orbitRadius: geoNum(r.orbitRadius) ?? 0,
      orbitAngle: geoNum(r.orbitAngle) ?? 0,
      themeColor: tc,
    });
  }
  const pois: GeoPoi[] = [];
  for (const r of poisIn as Record<string, unknown>[]) {
    const coord = geoVec3(r.coord);
    if (!r.name || typeof r.name !== "string" || !r.parentBody || !coord) continue;
    pois.push({
      name: r.name,
      type: String(r.type ?? ""),
      parentBody: String(r.parentBody),
      coord,
      wikiLink: (r.wikiLink as string) || null,
      quantum: r.quantum === true,
      hidden: r.hidden === true,
    });
  }
  const systems = (systemsIn as Record<string, unknown>[])
    .filter((s) => typeof s.name === "string")
    .map((s) => ({ name: s.name as string, star: String(s.star ?? s.name) }));
  return { systems, bodies, pois };
}

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
