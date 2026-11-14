import { findShipModel, hasVisitableInterior, normalizeShipKey, type Ship3DShip } from "../../lib/ship3d";
import type { ShipRow } from "./types";

export function fmtMB(bytes?: number): string {
  if (!bytes) return "—";
  return `${Math.round(bytes / 1e6)} Mo`;
}

type Models = Map<string, Ship3DShip>;

export function hasModel(models: Models, name: string): boolean {
  return findShipModel(models, name) != null;
}

// Rendu peint publié : badge « Peint » et bascule de rendu.
export function hasPainted(models: Models, name: string): boolean {
  return findShipModel(models, name)?.variants.some((v) => v.render === "painted") ?? false;
}

// Vaisseau « visitable » = a un intérieur HABITABLE publié (vraies pièces), pas un cockpit pur.
// SOURCE DE VÉRITÉ UNIQUE : l'index.json d'asset-3d. On se fie au flag `interiorKind`
// (`habitable` = ≥ 100 m² praticable, `cockpit` = habitacle nu) — beaucoup de mono-place
// (Cutter, Vulture, Terrapin…) ont un vrai habitacle et méritent la Visite. Flag absent
// (ancien index) = traité habitable. Aucun override local : une coque vide n'a simplement
// pas de variante `interior` dans l'index, donc pas de Visite — rien à coder en dur ici.
// (La collision de la Visite 1re personne reste pilotée par `render`/`hasCollision` au rendu.)
export function makeIsVisitable(models: Models) {
  return (s: ShipRow): boolean => hasVisitableInterior(findShipModel(models, s.name));
}

// Liste de l'onglet = vaisseaux de l'index asset-3D (vérité absolue : publication et exclusions
// décidées là-bas, aucune règle locale). La fiche du wiki y est rattachée par nom quand elle existe
// (équipage, cargo, image) ; sinon la ligne reprend constructeur, classe et dimensions de l'index.
// Nom et constructeur affichés : ceux de l'index. Une fiche du wiki ne sert qu'une fois ; une ligne sans fiche
// reçoit un id négatif (le paramètre ?ship= désigne un id du wiki).
export function buildShipRows(index: Ship3DShip[], wiki: ShipRow[]): ShipRow[] {
  const models: Models = new Map();
  for (const m of index) models.set(normalizeShipKey(m.name), m);
  for (const m of index) if (m.key && !models.has(normalizeShipKey(m.key))) models.set(normalizeShipKey(m.key), m);
  const byModel = new Map<Ship3DShip, ShipRow[]>();
  for (const w of wiki) {
    const m = findShipModel(models, w.name);
    if (m) byModel.set(m, [...(byModel.get(m) ?? []), w]);
  }
  const used = new Set<number>();
  return index.map((m, i) => {
    const key = normalizeShipKey(m.name);
    const candidates = (byModel.get(m) ?? []).filter((w) => !used.has(w.id));
    const w = candidates.find((c) => normalizeShipKey(c.name) === key) ?? candidates[0];
    if (w) {
      used.add(w.id);
      return { ...w, name: m.name, manufacturer: m.manufacturer || w.manufacturer };
    }
    return {
      id: -(i + 1),
      name: m.name,
      manufacturer: m.manufacturer ?? "",
      role: null,
      classification: m.classification ?? "",
      length: m.dims?.l ?? null,
      beam: m.dims?.b ?? null,
      height: m.dims?.h ?? null,
      crewMin: null,
      crewMax: null,
      cargoScu: null,
      imageUrl: null,
    };
  });
}
