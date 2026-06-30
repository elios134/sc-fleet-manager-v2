// Packing 3D des conteneurs DANS les vraies baies (grilles) de la soute.
//
// Données d'entrée = `cargo_grids` de l'API SC Wiki : chaque baie est une boîte
// parfaite de cellules 1,25 m (scu = nombre de cellules), avec une taille de
// conteneur maximale (maxScuBox). On remplit chaque baie au plus serré, du plus
// gros conteneur au plus petit (placement OPTIMISÉ — pas le placement exact in-game,
// que personne ne fournit en donnée). Logique pure → testable, réutilisée par le viewer.

import { CONTAINER_DIM } from "./cargoPack";

/** Une baie : dimensions en CELLULES (1 cellule = 1,25 m = 1 SCU). */
export type Bay = {
  cols: number; // largeur (axe X)
  rows: number; // profondeur (axe Z)
  layers: number; // hauteur (axe Y)
  scu: number;
  maxScuBox: number;
  open: boolean;
  external: boolean;
};

/** Un conteneur placé, en coordonnées CELLULES (origine baie incluse après layout). */
export type PackedContainer = {
  id: number;
  sizeScu: number;
  bay: number;
  x: number;
  y: number;
  z: number;
  w: number; // cellules sur X
  h: number; // cellules sur Y
  d: number; // cellules sur Z
};

/** Cadre d'une baie après disposition (origine + dimensions en cellules). */
export type BayFrame = Bay & { index: number; ox: number; oz: number };

// Tailles de conteneurs candidates, du plus gros au plus petit.
const CANDIDATES = [32, 24, 16, 8, 4, 2, 1].filter((s) => CONTAINER_DIM[s]);

/** Crée une grille d'occupation [x][y][z] vide. */
function emptyOcc(cols: number, layers: number, rows: number): boolean[][][] {
  return Array.from({ length: cols }, () =>
    Array.from({ length: layers }, () => new Array<boolean>(rows).fill(false)),
  );
}

function fits(occ: boolean[][][], x: number, y: number, z: number, w: number, h: number, d: number): boolean {
  for (let i = x; i < x + w; i++)
    for (let j = y; j < y + h; j++)
      for (let k = z; k < z + d; k++) if (occ[i][j][k]) return false;
  return true;
}

function mark(occ: boolean[][][], x: number, y: number, z: number, w: number, h: number, d: number): void {
  for (let i = x; i < x + w; i++)
    for (let j = y; j < y + h; j++) for (let k = z; k < z + d; k++) occ[i][j][k] = true;
}

/**
 * Remplit une baie, du plus gros conteneur au plus petit (≤ maxScuBox), au sol
 * d'abord puis en hauteur. Essaie les deux orientations au sol (w×d et d×w).
 * Renvoie les conteneurs en coordonnées LOCALES à la baie (origine 0,0,0).
 */
export function packBay(bay: Bay, bayIndex: number, startId = 0): PackedContainer[] {
  const { cols, rows, layers, maxScuBox } = bay;
  const occ = emptyOcc(cols, layers, rows);
  const out: PackedContainer[] = [];
  let id = startId;

  for (const scu of CANDIDATES) {
    if (scu > maxScuBox) continue;
    const [fw, fd, fh] = CONTAINER_DIM[scu]; // [w(x), d(z), h(y)]
    const orients: Array<[number, number]> = fw === fd ? [[fw, fd]] : [[fw, fd], [fd, fw]];
    let placed = true;
    while (placed) {
      placed = false;
      scan: for (let y = 0; y + fh <= layers; y++)
        for (let z = 0; z < rows; z++)
          for (let x = 0; x < cols; x++)
            for (const [w, d] of orients) {
              if (x + w <= cols && z + d <= rows && fits(occ, x, y, z, w, fh, d)) {
                mark(occ, x, y, z, w, fh, d);
                out.push({ id: id++, sizeScu: scu, bay: bayIndex, x, y, z, w, h: fh, d });
                placed = true;
                break scan;
              }
            }
    }
  }
  return out;
}

/**
 * Dispose les baies côte à côte (flux qui revient à la ligne) et empile les
 * conteneurs dedans. Renvoie les cadres de baie (origine en cellules) + tous les
 * conteneurs en coordonnées MONDE (origine de leur baie ajoutée).
 */
export function layoutBays(bays: Bay[]): { frames: BayFrame[]; containers: PackedContainer[] } {
  const GAP = 2;
  // Grosses baies d'abord (disposition plus compacte), index d'origine conservé.
  const order = bays.map((b, i) => ({ b, i })).sort((a, c) => c.b.scu - a.b.scu);
  const totalFoot = bays.reduce((a, b) => a + b.cols * b.rows, 0);
  const maxCols = bays.reduce((a, b) => Math.max(a, b.cols), 0);
  const targetW = Math.max(maxCols, Math.ceil(Math.sqrt(totalFoot) * 1.6));

  const frames: BayFrame[] = [];
  const containers: PackedContainer[] = [];
  let ox = 0;
  let oz = 0;
  let rowDepth = 0;
  let id = 0;

  for (const { b, i } of order) {
    if (ox > 0 && ox + b.cols > targetW) {
      ox = 0;
      oz += rowDepth + GAP;
      rowDepth = 0;
    }
    frames.push({ ...b, index: i, ox, oz });
    for (const c of packBay(b, i, id)) {
      containers.push({ ...c, x: c.x + ox, z: c.z + oz });
      id = c.id + 1;
    }
    ox += b.cols + GAP;
    rowDepth = Math.max(rowDepth, b.rows);
  }
  return { frames, containers };
}
