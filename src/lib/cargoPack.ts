// Packing de grille de soute (placement APPROXIMATIF — pas les positions in-game).
// Empreinte par taille de conteneur (volume w·d·h ≈ SCU), puis rangement en bandes :
// les conteneurs (triés gros→petit en amont) remplissent des rangées sur le sol.
// Logique pure → testable et réutilisée par le viewer 3D.

// Empreinte (w × d cellules) et hauteur (h cellules) par taille SCU.
export const CONTAINER_DIM: Record<number, [number, number, number]> = {
  1: [1, 1, 1],
  2: [2, 1, 1],
  4: [2, 2, 1],
  8: [2, 2, 2],
  16: [4, 2, 2],
  24: [4, 3, 2],
  32: [4, 4, 2],
};

/** Dimensions [w, d, h] d'un conteneur ; repli ~cubique pour une taille inconnue. */
export function containerDim(scu: number): [number, number, number] {
  if (CONTAINER_DIM[scu]) return CONTAINER_DIM[scu];
  const s = Math.max(1, Math.round(Math.sqrt(scu)));
  return [s, s, 2];
}

export type PackedBox<T> = { cell: T; gx: number; gz: number; w: number; d: number; h: number };

/** Range les conteneurs en bandes sur le sol (largeur cible ~ √aire). Aucun chevauchement. */
export function packCells<T extends { sizeScu: number }>(
  cells: T[],
  dim: (scu: number) => [number, number, number] = containerDim,
): PackedBox<T>[] {
  const GAP = 1;
  let area = 0;
  for (const c of cells) {
    const [w, d] = dim(c.sizeScu);
    area += (w + GAP) * (d + GAP);
  }
  const maxW = Math.max(8, Math.ceil(Math.sqrt(area) * 1.4));
  let cx = 0;
  let cz = 0;
  let rowD = 0;
  const out: PackedBox<T>[] = [];
  for (const c of cells) {
    const [w, d, h] = dim(c.sizeScu);
    if (cx + w > maxW) {
      cx = 0;
      cz += rowD + GAP;
      rowD = 0;
    }
    out.push({ cell: c, gx: cx, gz: cz, w, d, h });
    cx += w + GAP;
    rowD = Math.max(rowD, d);
  }
  return out;
}
