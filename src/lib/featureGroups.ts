// Regroupement des raccourcis de la page Fonctionnalités par catégorie.
// Logique pure (sans React) → testable. Exclut les raccourcis épinglés à la navbar
// (ils y sont déjà visibles → pas de doublon) et omet les catégories vides.

export type GroupedFeatures<I, C> = { category: C; items: I[] };

export function groupFeaturesByCategory<
  I extends { to: string; category: string },
  C extends { key: string },
>(items: I[], categories: C[], pinned: string[]): Array<GroupedFeatures<I, C>> {
  const pinnedSet = new Set(pinned);
  const out: Array<GroupedFeatures<I, C>> = [];
  for (const category of categories) {
    const its = items.filter((i) => i.category === category.key && !pinnedSet.has(i.to));
    if (its.length > 0) out.push({ category, items: its });
  }
  return out;
}
