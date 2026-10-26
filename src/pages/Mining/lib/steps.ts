import { mineralByKey, methodByKey } from "../../../lib/miningRegistry";
import { cleanOre } from "../helpers";
import type { OreLine } from "../types";

/** Parcours du Minage : 0 Extraire, 1 Raffiner, 2 Vendre, 3 Fabriquer. */
export const MINING_STEPS = 4;

/** Étapes ouvertes et étape courante : sans minerai saisi, seule l'étape 1 (Extraire) est
 *  ouverte. L'étape mémorisée est bornée à 0–3 (valeur invalide → 0). */
export function stepsState(rawScu: number, step: number): { current: number; enabled: boolean[] } {
  const hasLoad = rawScu > 0;
  const enabled = Array.from({ length: MINING_STEPS }, (_, i) => i === 0 || hasLoad);
  const bounded = Number.isFinite(step) ? Math.min(MINING_STEPS - 1, Math.max(0, Math.trunc(step))) : 0;
  return { current: hasLoad ? bounded : 0, enabled };
}

/** Matériaux raffinés du work order (pour le Crafting) : quantité brute × rendement de la
 *  méthode choisie, minéraux inconnus ou à 0 SCU écartés, plus grosse quantité d'abord. */
export function refinedMaterials(ore: OreLine[], methodKey: string | null): Array<{ key: string; name: string; refinedScu: number }> {
  const y = methodKey ? (methodByKey[methodKey]?.yieldMult ?? 1) : 1;
  return cleanOre(ore)
    .map((o) => ({ key: o.key, name: mineralByKey[o.key]!.name, refinedScu: o.scu * y }))
    .sort((a, b) => b.refinedScu - a.refinedScu);
}
