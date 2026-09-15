import { normalizeShipKey, type Ship3DShip } from "../../lib/ship3d";
import type { ShipRow } from "./types";

export function fmtMB(bytes?: number): string {
  if (!bytes) return "—";
  return `${Math.round(bytes / 1e6)} Mo`;
}

// Intérieurs VIDES ou INEXPLOITABLES : StarBreaker n'exporte pas les « object containers », donc sur
// certains vaisseaux l'intérieur est une coquille vide (aucune pièce/cloison/objet) ou trop dégradé
// → la Visite n'a aucun intérêt. Exclusion par nom, provisoire, en attendant un flag asset-3d.
export const EMPTY_INTERIOR = new Set(["Mauler Destroyer", "Ironclad", "Ironclad Assault"]);

// Variantes purement cosmétiques (peintures/éditions) exclues du tab 3D : pas de modèle distinct.
export const EXCLUDED_VARIANTS = /wikelo|pyam|best in show|exec/i;

type Models = Map<string, Ship3DShip>;

export function hasModel(models: Models, name: string): boolean {
  return models.has(normalizeShipKey(name));
}

// Vaisseau « visitable » = a un intérieur HABITABLE publié (vraies pièces), pas un cockpit pur.
// On se fie au flag `interiorKind` d'asset-3d (`habitable` = ≥ 100 m² praticable, `cockpit` = habitacle
// nu) plutôt qu'à l'équipage — beaucoup de mono-place (Cutter, Vulture, Terrapin…) ont un vrai
// habitacle et méritent la Visite. flag absent (ancien index) = traité habitable.
export function makeIsVisitable(models: Models) {
  return (s: ShipRow): boolean => {
    if (EMPTY_INTERIOR.has(s.name)) return false;
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
