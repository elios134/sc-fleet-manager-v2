// Contrat de la « mini-API » d'assets 3D (repo `asset-3d`, index.json schemaVersion 2).
// Chaque vaisseau a jusqu'à 3 variantes (niveaux de détail) : silhouette → exterior →
// interior. L'app n'affiche que les variantes présentes, charge « silhouette » par défaut
// et les autres à la demande (fichiers lourds). Tolérant à l'ancien format (modelUrl unique
// → traité comme la variante silhouette). Tant que l'API est absente → fallback image.
import { invoke } from "@tauri-apps/api/core";

export const SHIP3D_BASE_URL = "https://raw.githubusercontent.com/elios134/asset-3d/main";

export type Ship3DLevel = "silhouette" | "exterior" | "interior";
export const LEVEL_ORDER: Ship3DLevel[] = ["silhouette", "exterior", "interior"];

export interface Ship3DVariant {
  level: Ship3DLevel;
  label?: string;
  modelUrl: string;
  tris?: number;
  sizeBytes?: number;
  hasInterior?: boolean;
  sha256?: string;
  // Uniquement sur les variantes `interior` (pipeline HD asset-3d) : distingue un vrai habitacle
  // (lit/rack/pièces) d'un cockpit pur ou d'un véhicule terrestre, via la surface de plancher
  // praticable mesurée au build (seuil 100 m²). Absent = ancien index → traité comme habitable.
  interiorKind?: "habitable" | "cockpit";
  interiorWalkableM2?: number;
  // Mode de rendu (pivot « visite résine ») : "clay" → matcap uniforme (keepMaterials off) + le GLB
  // porte un nœud `collision_walk` (filet de sol) et un `spawn_point`. Absent/"textured" = HD legacy.
  render?: "textured" | "painted" | "clay";
  // Uniquement variante interior clay : le GLB contient une couche de collision (`collision_walk`).
  hasCollision?: boolean;
}

export interface Ship3DShip {
  key?: string;
  name: string; // = ShipData.name (jointure)
  manufacturer?: string;
  classification?: string;
  dims?: { l: number; b: number; h: number };
  variants: Ship3DVariant[];
}

export interface Ship3DLevelMeta {
  id: Ship3DLevel;
  label?: string;
  order?: number;
}

export interface Ship3DIndex {
  schemaVersion?: number;
  generatedAt?: string;
  patchVersion?: string;
  levels?: Ship3DLevelMeta[];
  ships: Ship3DShip[];
}

export function normalizeShipKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// URL absolue d'une variante (accepte une URL déjà absolue ou un chemin relatif).
export function ship3dModelUrl(v: { modelUrl: string }): string {
  return /^https?:\/\//.test(v.modelUrl) ? v.modelUrl : `${SHIP3D_BASE_URL}/${v.modelUrl.replace(/^\//, "")}`;
}

// Variantes triées par niveau (silhouette → exterior → interior).
export function sortedVariants(ship: Ship3DShip): Ship3DVariant[] {
  return [...ship.variants].sort((a, b) => LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level));
}

interface RawShip {
  key?: string;
  name?: string;
  manufacturer?: string;
  classification?: string;
  dims?: { l: number; b: number; h: number };
  variants?: Ship3DVariant[];
  // Ancien format (v1) : un seul modèle → variante silhouette.
  modelUrl?: string;
  tris?: number;
  sizeBytes?: number;
  sha256?: string;
}

function normalizeShip(s: RawShip): Ship3DShip | null {
  if (!s || !s.name) return null;
  let variants: Ship3DVariant[] = Array.isArray(s.variants)
    ? s.variants.filter((v) => v && v.modelUrl && v.level)
    : [];
  if (variants.length === 0 && s.modelUrl) {
    variants = [{ level: "silhouette", modelUrl: s.modelUrl, tris: s.tris, sizeBytes: s.sizeBytes, sha256: s.sha256 }];
  }
  if (variants.length === 0) return null;
  return {
    key: s.key,
    name: s.name,
    manufacturer: s.manufacturer,
    classification: s.classification,
    dims: s.dims,
    variants,
  };
}

// Récupère + normalise l'index. null = API absente/injoignable (→ fallback image).
export async function fetchShip3DIndex(): Promise<Ship3DIndex | null> {
  try {
    // cache-bust (?cb=) en plus de no-store : le CDN raw.githubusercontent garde l'index en
    // cache ~5 min et servait une version périmée (17 vaisseaux au lieu de 229). Le paramètre
    // unique force une réponse fraîche à chaque lancement.
    // Dev (`npm run tauri dev`) : index local d'asset-3D (index.dev.json) s'il existe → essais sans publier.
    const dev = import.meta.env.DEV ? await invoke<string | null>("ship3d_dev_index").catch(() => null) : null;
    const res = dev ? null : await fetch(`${SHIP3D_BASE_URL}/index.json?cb=${Date.now()}`, { cache: "no-store" });
    if (res && !res.ok) return null;
    const raw = (dev ? JSON.parse(dev) : await res!.json()) as {
      schemaVersion?: number;
      generatedAt?: string;
      patchVersion?: string;
      levels?: Ship3DLevelMeta[];
      ships?: RawShip[];
    };
    if (!raw || !Array.isArray(raw.ships)) return null;
    const ships = raw.ships.map(normalizeShip).filter((s): s is Ship3DShip => s !== null);
    return { schemaVersion: raw.schemaVersion, generatedAt: raw.generatedAt, patchVersion: raw.patchVersion, levels: raw.levels, ships };
  } catch {
    return null;
  }
}

// Vaisseaux indexés par clé normalisée (nom ET clé, pour être tolérant).
export function indexShipsByName(idx: Ship3DIndex | null): Map<string, Ship3DShip> {
  const map = new Map<string, Ship3DShip>();
  if (!idx) return map;
  for (const s of idx.ships) {
    map.set(normalizeShipKey(s.name), s);
    if (s.key) map.set(normalizeShipKey(s.key), s);
  }
  // Clés sans génération (« mk-iv ») en repli, sans écraser une clé exacte.
  for (const s of idx.ships) {
    const loose = looseShipKey(s.name);
    if (!map.has(loose)) map.set(loose, s);
  }
  return map;
}

/** Clé sans la génération « Mk IV / Mk V » : l'index asset-3d nomme « Constellation Andromeda »
 *  ce que les données de jeu appellent « Constellation Mk IV Andromeda ». */
function looseShipKey(name: string): string {
  return normalizeShipKey(name).replace(/(^|-)mk-[ivx]+(?=-|$)/g, "").replace(/^-|-$/g, "");
}

/** Modèle 3D d'un vaisseau : par nom exact, sinon par nom sans génération. */
export function findShipModel(models: Map<string, Ship3DShip>, name: string): Ship3DShip | undefined {
  return models.get(normalizeShipKey(name)) ?? models.get(looseShipKey(name));
}

export type ShipRender = "clay" | "painted" | "textured";

/** Variante à afficher pour un niveau selon le rendu préféré, et le repli clay à montrer pendant
 *  le téléchargement (chargement progressif). Une variante sans `render` (ancien index) est texturée ;
 *  si le rendu préféré manque : texturé, puis peint, puis clay. */
export function pickVariant(
  variants: Ship3DVariant[],
  level: Ship3DLevel,
  prefer: ShipRender,
): { main: Ship3DVariant | null; fallback: Ship3DVariant | null } {
  const of = (r: ShipRender) => variants.find((v) => v.level === level && (v.render ?? "textured") === r) ?? null;
  const order: ShipRender[] = prefer === "clay" ? ["clay", "textured", "painted"] : [prefer, "textured", "painted", "clay"];
  const main = order.map(of).find((v) => v) ?? null;
  const clay = of("clay");
  return { main, fallback: main && main !== clay ? clay : null };
}

/** Rendus publiés pour un niveau (ordre d'affichage de la bascule). */
export function availableRenders(variants: Ship3DVariant[], level: Ship3DLevel): ShipRender[] {
  const all: ShipRender[] = ["clay", "painted", "textured"];
  return all.filter((r) => variants.some((v) => v.level === level && (v.render ?? "textured") === r));
}
