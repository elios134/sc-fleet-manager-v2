// Numéros de page « 1 2 3 … N » avec ellipses (≤ fenêtre → tous ; sinon 1, voisins de la
// page courante, dernière, avec « … » entre les sauts). Extrait de CraftingHubPage pour
// être partagé (Ma Flotte, Crafting Hub…). Algorithme inchangé.
export function computePageNumbers(current: number, total: number): (number | "…")[] {
  const out: (number | "…")[] = [];
  for (let p = 1; p <= total; p++) {
    if (p === 1 || p === total || Math.abs(p - current) <= 1) {
      if (out.length > 0 && out[out.length - 1] !== "…" && p - (out[out.length - 1] as number) > 1) {
        out.push("…");
      }
      out.push(p);
    }
  }
  return out;
}
