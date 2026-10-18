// Provenance des composants, coût du loadout et jauge d'énergie (logique pure, testée).
import type { AcqDetailData, SlotEdit } from "./types";

export type Provenance =
  | { kind: "stock" }
  | { kind: "buy"; terminal: string; price: number }
  | { kind: "craft" }
  | { kind: "unknown" };

/** D'où vient le composant monté : d'origine, magasin le moins cher, craftable, ou inconnu. */
export function provenanceOf(slot: SlotEdit, stockClass: string | null, acq: AcqDetailData | null): Provenance {
  if (slot.componentClassName && stockClass && slot.componentClassName.toLowerCase() === stockClass.toLowerCase()) return { kind: "stock" };
  const buys = (acq?.buy ?? []).filter((b): b is { terminal: string; price: number } => b.terminal != null && b.price != null && b.price > 0);
  if (buys.length) {
    const best = buys.reduce((a, b) => (b.price < a.price ? b : a));
    return { kind: "buy", terminal: best.terminal, price: best.price };
  }
  if (acq?.craft) return { kind: "craft" };
  return { kind: "unknown" };
}

export function loadoutCost(items: Provenance[]): {
  owned: number;
  craft: number;
  unknown: number;
  byTerminal: { terminal: string; total: number }[];
  total: number;
} {
  const by: Record<string, number> = {};
  let owned = 0, craft = 0, unknown = 0;
  for (const p of items) {
    if (p.kind === "stock") owned++;
    else if (p.kind === "craft") craft++;
    else if (p.kind === "unknown") unknown++;
    else by[p.terminal] = (by[p.terminal] ?? 0) + p.price;
  }
  const byTerminal = Object.entries(by).map(([terminal, total]) => ({ terminal, total })).sort((a, b) => b.total - a.total);
  return { owned, craft, unknown, byTerminal, total: byTerminal.reduce((n, x) => n + x.total, 0) };
}

/** Jauge de n pips : part de la production électrique consommée. */
export function powerPips(draw: number, output: number, n: number): { on: number; over: boolean } {
  if (output <= 0) return { on: 0, over: false };
  return { on: Math.round(Math.min(draw / output, 1) * n), over: draw > output };
}

/** Clé d'une tournée d'achat : le résultat n'est affiché que pour la liste qui l'a produit. */
export function routeKey(names: string[]): string {
  return [...names].sort().join("|");
}

export function fmtMinutes(m: number | null | undefined): string {
  return m == null ? "?" : String(Math.round(m));
}

/** Vaisseau ouvert à l'arrivée : ?ship= (flotte si possédé, sinon catalogue), présélection, 1er de la flotte. */
export function initialShip(
  fleet: { id: number; shipDataId: number | null }[],
  shipParam: number | null,
  preselectId: number | null,
): { kind: "owned"; id: number } | { kind: "catalog"; shipDataId: number } | null {
  if (shipParam) {
    const owned = fleet.find((s) => s.shipDataId === shipParam);
    return owned ? { kind: "owned", id: owned.id } : { kind: "catalog", shipDataId: shipParam };
  }
  if (fleet.length === 0) return null;
  const id = preselectId != null && fleet.some((s) => s.id === preselectId) ? preselectId : fleet[0].id;
  return { kind: "owned", id };
}
