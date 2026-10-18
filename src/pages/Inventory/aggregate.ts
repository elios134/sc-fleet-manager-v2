import type { ItemMeta, InvState, Stack } from "./types";
import { placeLabel, resolveScope, type BodyRef } from "./resolve";

// Miroir TS de commands/inventory/model.rs (jolie/categorie) — garder identique au Rust.
const PREFIXES = ["carryable_tbo_", "carryable_", "item_", "char_armor_", "char_clothing_", "weapon_personal_", "fps_consumable_", "mtag_"];

export function jolie(classe: string): string {
  let s = classe.toLowerCase();
  for (const p of PREFIXES) {
    if (s.startsWith(p)) { s = s.slice(p.length); break; }
  }
  return s.split(/[_\s]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

export function categorie(classe: string): string {
  const c = classe.toLowerCase();
  if (c.startsWith("weapon_")) return "Armes";
  if (c.startsWith("char_armor_")) return "Armure";
  if (c.startsWith("char_clothing_")) return "Vêtements";
  if (c.startsWith("fps_consumable") || c.includes("medpen") || c.includes("oxypen")) return "Consommables";
  if (c.includes("_shield") || c.includes("_qdrive") || c.includes("quantum") || c.includes("cooler") || c.includes("powerplant")) return "Composants";
  return "Divers";
}

export type InvRow = { classe: string; nom: string; categorie: string; qte: number; vu: number; imageUrl: string | null };

const sumStacks = (m: Record<string, Stack> | undefined) => Object.values(m ?? {}).reduce((n, s) => n + s.qte, 0);

export type ScopeTree = {
  systems: { name: string; count: number }[];
  planetsBySystem: Record<string, { name: string; count: number; moon: boolean }[]>;
  placesByPlanet: Record<string, { name: string; count: number; type: string; locId: string }[]>;
  moiCount: number;
};

export function buildScopeTree(state: InvState, bodies: BodyRef[]): ScopeTree {
  const sysMap: Record<string, number> = {};
  const planetMap: Record<string, Record<string, { count: number; moon: boolean }>> = {};
  const placeMap: Record<string, { name: string; count: number; type: string; locId: string }[]> = {};
  // contenu des contenants agrégé sur leur lieu parent (sinon il serait invisible).
  const extraByLoc: Record<string, number> = {};
  for (const [key, stacks] of Object.entries(state.possessions)) {
    if (!key.startsWith("C:")) continue;
    const lieu = state.contenants[key.slice(2)]?.lieu;
    if (lieu == null) continue;
    extraByLoc[String(lieu)] = (extraByLoc[String(lieu)] ?? 0) + sumStacks(stacks);
  }
  for (const [key, stacks] of Object.entries(state.possessions)) {
    if (!key.startsWith("L:")) continue; // MOI traité à part ; C:* replié sur son lieu parent
    const locId = key.slice(2);
    const count = sumStacks(stacks) + (extraByLoc[locId] ?? 0);
    if (count <= 0) continue;
    const brut = state.lieux[locId]?.nom;
    const nom = brut ? placeLabel(brut) : `Lieu #${locId}`;
    const scope = resolveScope(state.lieux[locId]?.nom ?? null, bodies);
    const sys = scope.system ?? "Inconnu";
    const planet = scope.planet ?? "Inconnu";
    sysMap[sys] = (sysMap[sys] ?? 0) + count;
    (planetMap[sys] ??= {})[planet] = {
      count: (planetMap[sys]?.[planet]?.count ?? 0) + count,
      moon: bodies.find((b) => b.name === planet)?.navIcon === "Moon",
    };
    (placeMap[planet] ??= []).push({ name: nom, count, type: "lieu", locId });
  }
  return {
    systems: Object.entries(sysMap).map(([name, count]) => ({ name, count })),
    planetsBySystem: Object.fromEntries(
      Object.entries(planetMap).map(([s, ps]) => [s, Object.entries(ps).map(([name, x]) => ({ name, count: x.count, moon: x.moon }))]),
    ),
    placesByPlanet: placeMap,
    moiCount: sumStacks(state.possessions.MOI),
  };
}

function rows(stacks: Record<string, Stack> | undefined): InvRow[] {
  return Object.entries(stacks ?? {})
    .map(([classe, s]) => ({ classe, nom: jolie(classe), categorie: categorie(classe), qte: s.qte, vu: s.vu, imageUrl: null }))
    .sort(byCat);
}

const byCat = (a: InvRow, b: InvRow) => a.categorie.localeCompare(b.categorie) || b.qte - a.qte;

/** Catégorie d'après le classement SC Wiki (« FPS.Armor.Torso »…) ; null si inconnu. */
export function categorieWiki(classification: string | null): string | null {
  if (!classification) return null;
  const c = classification.toLowerCase();
  if (c.startsWith("fps.armor")) return "Armure";
  if (c.startsWith("fps.weapon")) return "Armes";
  if (c.startsWith("fps.consumable")) return "Consommables";
  if (c.startsWith("fps.clothing")) return "Vêtements";
  if (c.startsWith("ship.")) return "Composants";
  return null;
}

/** Remplace nom / image / catégorie devinés par ceux du Wiki quand on les a. */
export function applyMeta(rows: InvRow[], meta: Record<string, ItemMeta>): InvRow[] {
  return rows
    .map((r) => {
      const m = meta[r.classe];
      if (!m) return r;
      return { ...r, nom: m.name ?? r.nom, imageUrl: m.imageUrl ?? r.imageUrl, categorie: categorieWiki(m.classification) ?? r.categorie };
    })
    .sort(byCat);
}

export function rowsForPlace(state: InvState, locId: string): InvRow[] {
  const merged: Record<string, Stack> = { ...(state.possessions[`L:${locId}`] ?? {}) };
  for (const [key, stacks] of Object.entries(state.possessions)) {
    if (!key.startsWith("C:")) continue;
    if (String(state.contenants[key.slice(2)]?.lieu ?? "") !== locId) continue;
    for (const [classe, s] of Object.entries(stacks)) {
      const cur = merged[classe];
      merged[classe] = cur ? { qte: cur.qte + s.qte, vu: Math.max(cur.vu, s.vu) } : s;
    }
  }
  return rows(merged);
}
export const rowsForMoi = (state: InvState): InvRow[] => rows(state.possessions.MOI);

/** « N objets · M unités » d'une liste de lignes. */
export function summarize(rows: InvRow[]): { types: number; units: number } {
  return { types: rows.length, units: rows.reduce((n, r) => n + r.qte, 0) };
}
