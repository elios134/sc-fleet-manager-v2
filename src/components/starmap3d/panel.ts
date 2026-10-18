// Logique pure du rail des lieux et de la fiche de la carte (testée).
import { SYSTEM_NAMES, safeName, type StarmapBodyItem } from "./starmapData";
import type { CargoRoute } from "../../pages/CargoRoutes/types";
import type { ScopeTree } from "../../pages/Inventory/aggregate";

export function bodyJoinKey(b: StarmapBodyItem): string {
  return (b.wikiUuid ?? b.recordName.split(".").pop() ?? "").toLowerCase();
}
export function parentJoinKey(b: StarmapBodyItem): string {
  return (b.parentRef ?? "").toLowerCase();
}

export type SystemSummary = { id: string; name: string; planets: number; moons: number };

/** Systèmes présents : nombre de planètes / lunes ; systèmes avec étoile d'abord, puis par nom. */
export function systemSummaries(bodies: StarmapBodyItem[]): SystemSummary[] {
  const ids = [...new Set(bodies.map((b) => b.systemName).filter(Boolean))];
  const hasStar = (id: string) => bodies.some((b) => b.systemName === id && b.navIcon === "Star");
  return ids
    .map((id) => ({
      id,
      name: SYSTEM_NAMES[id.toLowerCase()] ?? id.toUpperCase(),
      planets: bodies.filter((b) => b.systemName === id && b.navIcon === "Planet" && !b.hideInStarmap).length,
      moons: bodies.filter((b) => b.systemName === id && b.navIcon === "Moon" && !b.hideInStarmap).length,
    }))
    .sort((a, b) => Number(hasStar(b.id)) - Number(hasStar(a.id)) || a.id.localeCompare(b.id));
}

export type TreeKind = "star" | "planet" | "moon" | "station" | "belt" | "jump";
export type TreeNode = { body: StarmapBodyItem; kind: TreeKind; depth: 0 | 1 };

const KIND: Record<string, TreeKind> = {
  Star: "star", Planet: "planet", Moon: "moon", Station: "station", AsteroidBelt: "belt", Jumppoint: "jump",
};

function childrenOf(parent: StarmapBodyItem, bodies: StarmapBodyItem[]): StarmapBodyItem[] {
  const k = bodyJoinKey(parent);
  const kids = bodies.filter((c) => !c.hideInStarmap && parentJoinKey(c) === k && (c.navIcon === "Station" || c.navIcon === "Moon"));
  return [...kids.filter((c) => c.navIcon === "Station"), ...kids.filter((c) => c.navIcon === "Moon")];
}

/** Arbre du rail : étoile, planètes (par distance) avec stations puis lunes sous la planète
 *  sélectionnée, ceintures, jump points. Avec une requête : tous systèmes, seuls les corps
 *  correspondants (une planète reste affichée pour situer un enfant trouvé). */
export function bodyTree(bodies: StarmapBodyItem[], system: string, selectedId: string | null, query: string): TreeNode[] {
  const q = query.trim().toLowerCase();
  const match = (b: StarmapBodyItem) => safeName(b).toLowerCase().includes(q);
  const pool = bodies.filter((b) => !b.hideInStarmap && (q ? true : b.systemName === system));
  const of = (icon: string) => pool.filter((b) => b.navIcon === icon);
  const planets = of("Planet").sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
  const out: TreeNode[] = [];
  const top = (b: StarmapBodyItem) => out.push({ body: b, kind: KIND[b.navIcon], depth: 0 });
  for (const s of of("Star")) if (!q || match(s)) top(s);
  for (const p of planets) {
    const kids = childrenOf(p, pool);
    const shownKids = q ? kids.filter(match) : p.id === selectedId || kids.some((k) => k.id === selectedId) ? kids : [];
    if (q && !match(p) && shownKids.length === 0) continue;
    top(p);
    for (const k of shownKids) out.push({ body: k, kind: KIND[k.navIcon], depth: 1 });
  }
  for (const x of [...of("AsteroidBelt"), ...of("Jumppoint")]) if (!q || match(x)) top(x);
  return out;
}

/** Noms sous lesquels UEX / Cargo désignent le lieu : le corps et ses stations. */
export function locationNames(body: StarmapBodyItem, bodies: StarmapBodyItem[]): string[] {
  const stations = childrenOf(body, bodies).filter((c) => c.navIcon === "Station").map(safeName);
  return [safeName(body), ...stations];
}

/** Meilleure route (profit max) dont le départ correspond à un des noms du lieu. */
export function bestRouteFrom(routes: CargoRoute[], names: string[]): CargoRoute | null {
  const ns = names.map((n) => n.trim().toLowerCase()).filter((n) => n.length >= 3);
  const hits = routes.filter((r) => {
    const from = r.fromLocation.toLowerCase();
    return ns.some((n) => from.includes(n) || n.includes(from));
  });
  return hits.reduce<CargoRoute | null>((best, r) => (!best || r.profit > best.profit ? r : best), null);
}

const FRESH_HOURS = 48;

/** Âge d'un prix UEX (secondes epoch) : heures sous 24 h, puis jours ; frais ≤ 48 h. */
export function freshness(epochSecs: number | null, now: Date): { label: "h" | "d"; n: number; fresh: boolean } | null {
  if (epochSecs == null) return null;
  const h = Math.max(0, Math.round((now.getTime() / 1000 - epochSecs) / 3600));
  return h < 24 ? { label: "h", n: h, fresh: true } : { label: "d", n: Math.floor(h / 24), fresh: h <= FRESH_HOURS };
}

/** Lieux de l'inventaire Game.log rangés sous ce corps. */
export function inventoryAt(tree: ScopeTree | null, bodyName: string): { name: string; count: number }[] {
  return (tree?.placesByPlanet[bodyName] ?? []).map((p) => ({ name: p.name, count: p.count }));
}

/** Latitude / longitude (degrés entiers) d'un POI, dans le repère du rendu (Y vers le haut). */
export function poiLatLon(coord: [number, number, number]): { lat: number; lon: number } | null {
  const [x, y, z] = coord;
  const len = Math.hypot(x, y, z);
  if (len < 1e-6) return null;
  const deg = (r: number) => Math.round((r * 180) / Math.PI) + 0; // + 0 : pas de « -0 »
  return { lat: deg(Math.asin(y / len)), lon: deg(Math.atan2(z, x)) };
}
