import { layoutBays, type Bay, type BayFrame } from "../../lib/cargoBays";

/* ── Types (miroir Rust) ── */
export type FleetShip = { name: string; manufacturer: string | null; cargoScu: number | null; role: string | null };
export type ShipGroup = "fleet" | "all";
export type Container = { sizeScu: number; count: number };
export type CargoGridResult = {
  shipName: string;
  found: boolean;
  tentative: boolean;
  totalScu: number;
  containerCount: number;
  containers: Container[];
};
export type ManifestItem = { id: number; commodity: string; scu: number };
export type CargoBaysResult = { shipName: string; found: boolean; totalScu: number; bays: Bay[] };
export type Placement = { x: number; y: number; z: number; w: number; h: number; d: number };
export type Cell = { id: number; sizeScu: number; commodity: string | null; pos?: Placement; bay?: number };

// Grille de soute : cellules de base (baies + conteneurs posés) et aplatissement.

/* ── Helpers ── */
// Construit les conteneurs VIDES de base : baies Wiki (packing 3D fidèle) si dispo,
// sinon composition Ratjack aplatie (placement approximatif côté viewer).
export function buildBaseCells(b: CargoBaysResult | null, g: CargoGridResult): { cells: Cell[]; frames: BayFrame[] } {
  if (b?.found && b.bays.length > 0) {
    const { frames, containers } = layoutBays(b.bays);
    const cells: Cell[] = containers.map((c) => ({
      id: c.id,
      sizeScu: c.sizeScu,
      commodity: null,
      pos: { x: c.x, y: c.y, z: c.z, w: c.w, h: c.h, d: c.d },
      bay: c.bay,
    }));
    cells.sort((a, z) => z.sizeScu - a.sizeScu); // best-fit + lisibilité légende
    return { cells, frames };
  }
  return { cells: flatten(g), frames: [] };
}

export function flatten(g: CargoGridResult): Cell[] {
  const out: Cell[] = [];
  let id = 0;
  for (const c of g.containers) {
    for (let i = 0; i < c.count; i++) out.push({ id: id++, sizeScu: c.sizeScu, commodity: null });
  }
  // tri desc par taille (best-fit + lisibilité)
  out.sort((a, b) => b.sizeScu - a.sizeScu);
  return out;
}
