import { normalizeShipKey, type Ship3DShip } from "../../lib/ship3d";
import type { ShipRow } from "./types";

export function fmtMB(bytes?: number): string {
  if (!bytes) return "—";
  return `${Math.round(bytes / 1e6)} Mo`;
}

// Variantes purement cosmétiques (peintures/éditions) exclues du tab 3D : pas de modèle distinct.
export const EXCLUDED_VARIANTS = /wikelo|pyam|best in show|exec/i;

type Models = Map<string, Ship3DShip>;

export function hasModel(models: Models, name: string): boolean {
  return models.has(normalizeShipKey(name));
}

// Vaisseau « visitable » = a un intérieur HABITABLE publié (vraies pièces), pas un cockpit pur.
// SOURCE DE VÉRITÉ UNIQUE : l'index.json d'asset-3d. On se fie au flag `interiorKind`
// (`habitable` = ≥ 100 m² praticable, `cockpit` = habitacle nu) — beaucoup de mono-place
// (Cutter, Vulture, Terrapin…) ont un vrai habitacle et méritent la Visite. Flag absent
// (ancien index) = traité habitable. Aucun override local : une coque vide n'a simplement
// pas de variante `interior` dans l'index, donc pas de Visite — rien à coder en dur ici.
// (La collision de la Visite 1re personne reste pilotée par `render`/`hasCollision` au rendu.)
export function makeIsVisitable(models: Models) {
  return (s: ShipRow): boolean => {
    const interior = models.get(normalizeShipKey(s.name))?.variants.find((v) => v.level === "interior");
    return !!interior && interior.interiorKind !== "cockpit";
  };
}

// Vaisseaux dédupliqués (hors variantes cosmétiques) — base des filtres et de la liste.
export function dedupShips(ships: ShipRow[]): ShipRow[] {
  const seen = new Set<string>();
  return ships.filter((s) =>
    EXCLUDED_VARIANTS.test(s.name) ? false : seen.has(s.name) ? false : (seen.add(s.name), true),
  );
}
