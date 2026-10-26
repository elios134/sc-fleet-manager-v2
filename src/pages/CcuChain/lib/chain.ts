import { shipName } from "../helpers";
import type { CcuPath, CcuShip, Step, WarbondTag } from "../types";

/** Un vaisseau de la frise : possédé (déjà dans le hangar), cible, ou simple étape. */
export type ChainRole = "owned" | "goal" | "step";
export type ChainNode = {
  shipId: number;
  name: string;
  priceCents: number | null;
  role: ChainRole;
  /** Prix de la montée qui mène à ce vaisseau (null pour le départ). */
  stepCostCents: number | null;
  tag: WarbondTag;
  /** Montée vers ce vaisseau en stock limité (stock restant s'il est connu). */
  limited: boolean;
  stock: number | null;
};

/** Nœuds de la frise d'un chemin : départ, chaque étape puis la cible. Un vaisseau est
 *  « possédé » quand la montée qui en part utilise un vaisseau du hangar. Les montées jusqu'à
 *  `warbondEndIndex` sont warbond, les suivantes standard. */
export function chainNodes(path: CcuPath, shipsById: Map<number, CcuShip>): ChainNode[] {
  const { steps } = path;
  if (steps.length === 0) return [];
  const node = (shipId: number, role: ChainRole, stepCostCents: number | null, tag: WarbondTag, step?: Step): ChainNode => {
    const meta = shipsById.get(shipId);
    return {
      shipId,
      name: shipName(shipsById, shipId),
      priceCents: meta?.priceCents ?? null,
      role,
      stepCostCents,
      tag,
      limited: step?.isLimited ?? false,
      stock: step?.stock ?? null,
    };
  };
  const first = steps[0]!;
  const nodes = [node(first.fromShipId, first.isOwnedSourceShip ? "owned" : "step", null, "none")];
  steps.forEach((s, i) => {
    const last = i === steps.length - 1;
    const role: ChainRole = last ? "goal" : steps[i + 1]!.isOwnedSourceShip ? "owned" : "step";
    const tag: WarbondTag = path.warbondEndIndex === null ? "none" : i <= path.warbondEndIndex ? "warbond" : "standard";
    nodes.push(node(s.toShipId, role, s.upgradePriceCents, tag, s));
  });
  return nodes;
}

/** Vaisseaux proposés dans les listes « Je pars de » / « Je veux » : ceux du hangar d'abord,
 *  triés par nom, sans les noms non résolus (« Ship #id »). Côté cible, seulement les
 *  vaisseaux achetables en CCU. Filtres cumulables : dans ma flotte, en vente, prix warbond.
 *  Le vaisseau déjà choisi (`keepId`) reste proposé même si un filtre l'écarte, pour que la
 *  liste affiche toujours son nom. */
export type ShipFilter = { owned?: boolean; available?: boolean; warbond?: boolean };
export function shipChoices(ships: CcuShip[], mode: "from" | "to", f: ShipFilter = {}, keepId?: number): { owned: CcuShip[]; others: CcuShip[] } {
  const usable = ships
    .filter((s) => !/^Ship #\d+$/.test(s.name) && (mode === "from" || s.priceSource === "ccu"))
    .filter((s) => s.shipId === keepId || ((!f.owned || s.isOwned) && (!f.available || s.isAvailable) && (!f.warbond || s.isWarbondPrice)))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { owned: usable.filter((s) => s.isOwned), others: usable.filter((s) => !s.isOwned) };
}

/** Chemins triés par coût (puis nombre d'étapes) ou par économie (inconnue en dernier).
 *  L'index d'origine est gardé : le chemin #0 (le moins cher) reste « le meilleur ». */
export function sortPaths(paths: CcuPath[], mode: "cost" | "saving"): Array<{ p: CcuPath; originalIndex: number }> {
  const indexed = paths.map((p, originalIndex) => ({ p, originalIndex }));
  return mode === "saving"
    ? indexed.sort((a, b) => (b.p.savingCents ?? -Infinity) - (a.p.savingCents ?? -Infinity))
    : indexed.sort((a, b) => a.p.totalCostCents - b.p.totalCostCents || a.p.stepCount - b.p.stepCount);
}
