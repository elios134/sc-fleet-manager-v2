// Sidecar LUMIÈRES des intérieurs (asset-3d) : un `<KEY>.lights.json` par vaisseau, publié à côté
// des .glb (référencé par `variants[].lights` dans l'index). Contient TOUTES les KHR_lights_punctual
// de l'export StarBreaker (le .glb lui-même les strippe : three.js ne survit pas à ~2000 lumières
// actives). L'app n'en allume qu'un petit POOL : les N plus « utiles » autour du joueur, choisies
// via une grille spatiale (lookup O(cellules voisines), pas O(2000)) et re-sélectionnées quand le
// joueur se déplace. Repère = celui du .glb intérieur (mètres, Y-up, même origine) → positions
// utilisables telles quelles. Couleurs LINÉAIRES 0-1 (three.js travaille en linéaire → direct).

export interface ShipLightDef {
  type: "point" | "spot";
  pos: [number, number, number];
  color: [number, number, number];
  /** Candela KHR brute (source CIG, 0 à ~75 000) — un gain global app est appliqué au rendu. */
  intensity: number;
  /** Portée finie en mètres (0 = « infini » KHR → clampée au rendu). */
  range: number;
  /** Spots uniquement : direction MONDE normalisée (-Z KHR appliqué). */
  dir?: [number, number, number];
  innerConeAngle?: number;
  outerConeAngle?: number;
}

export interface ShipLightsFile {
  key?: string;
  count?: number;
  lights: ShipLightDef[];
}

// Parse + assainit le JSON sidecar. Écarte les lumières éteintes (intensity ≤ 0 — présentes dans
// la source) et malformées : poids mort pour la grille.
export function parseShipLights(bytes: ArrayBuffer): ShipLightDef[] {
  try {
    const raw = JSON.parse(new TextDecoder().decode(bytes)) as ShipLightsFile;
    if (!raw || !Array.isArray(raw.lights)) return [];
    return raw.lights.filter(
      (l) =>
        l &&
        (l.type === "point" || l.type === "spot") &&
        Array.isArray(l.pos) && l.pos.length === 3 && l.pos.every(Number.isFinite) &&
        Array.isArray(l.color) && l.color.length === 3 &&
        Number.isFinite(l.intensity) && l.intensity > 0,
    );
  } catch {
    return [];
  }
}

const CELL = 8; // m — taille de cellule de la grille (≈ une pièce)

// Grille spatiale 3D → sélection des lumières candidates autour d'un point sans parcourir la liste
// entière. Construite une fois au chargement du vaisseau.
export class LightGrid {
  private cells = new Map<string, number[]>();
  readonly lights: ShipLightDef[];

  constructor(lights: ShipLightDef[]) {
    this.lights = lights;
    lights.forEach((l, i) => {
      const k = this.key(l.pos[0], l.pos[1], l.pos[2]);
      const arr = this.cells.get(k);
      if (arr) arr.push(i);
      else this.cells.set(k, [i]);
    });
  }

  private key(x: number, y: number, z: number): string {
    return `${Math.floor(x / CELL)},${Math.floor(y / CELL)},${Math.floor(z / CELL)}`;
  }

  /** Indices des lumières dans les cellules à ≤ `radius` m de (x,y,z) (pré-filtre grossier). */
  collect(x: number, y: number, z: number, radius: number): number[] {
    const r = Math.max(1, Math.ceil(radius / CELL));
    const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL), cz = Math.floor(z / CELL);
    const out: number[] = [];
    for (let ix = cx - r; ix <= cx + r; ix++)
      for (let iy = cy - r; iy <= cy + r; iy++)
        for (let iz = cz - r; iz <= cz + r; iz++) {
          const arr = this.cells.get(`${ix},${iy},${iz}`);
          if (arr) out.push(...arr);
        }
    return out;
  }

  /**
   * Les N lumières les plus UTILES autour du joueur, par type. Score = contribution perçue
   * `intensity / (d² + 1)` (une lumière forte un peu plus loin bat une faible collée) ; les
   * lumières hors portée utile (d > range + 2 m) sont écartées.
   */
  nearest(
    x: number, y: number, z: number,
    maxPoint: number, maxSpot: number, radius: number,
  ): { points: ShipLightDef[]; spots: ShipLightDef[] } {
    const scored: { l: ShipLightDef; s: number }[] = [];
    for (const i of this.collect(x, y, z, radius)) {
      const l = this.lights[i];
      const dx = l.pos[0] - x, dy = l.pos[1] - y, dz = l.pos[2] - z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > radius * radius) continue;
      const reach = Math.min(l.range > 0 ? l.range : radius, radius) + 2;
      if (d2 > reach * reach) continue;
      scored.push({ l, s: l.intensity / (d2 + 1) });
    }
    scored.sort((a, b) => b.s - a.s);
    const points: ShipLightDef[] = [];
    const spots: ShipLightDef[] = [];
    for (const { l } of scored) {
      if (l.type === "point") { if (points.length < maxPoint) points.push(l); }
      else if (spots.length < maxSpot) spots.push(l);
      if (points.length >= maxPoint && spots.length >= maxSpot) break;
    }
    return { points, spots };
  }
}
