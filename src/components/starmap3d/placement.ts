// Placement orbital 3D — maths pures (aucune dépendance THREE/r3f), mirroir Stelliverse.
// Alimenté par les champs natifs RSI (distance/longitude) exposés par get_starmap_bodies.
export const SYS_R = 360;
export const R_MIN = 26;
export const TILT_DEG = 20;
export const PLANET_VR = 4.2;
const TILT = (TILT_DEG * Math.PI) / 180;

export type Vec3 = [number, number, number];

/** Rayon orbital comprimé en sqrt : R_MIN (d=0) → SYS_R (d=maxD). */
export function orbitRadius(d: number, maxD: number): number {
  if (maxD <= 0) return R_MIN;
  return R_MIN + (SYS_R - R_MIN) * Math.sqrt(Math.max(0, d) / maxD);
}

/** Position dans le plan écliptique (XZ incliné de TILT autour de X). */
export function placeOnPlane(R: number, lonDeg: number): Vec3 {
  const a = (lonDeg * Math.PI) / 180;
  const x = R * Math.cos(a);
  const z = R * Math.sin(a);
  return [x, -z * Math.sin(TILT), z * Math.cos(TILT)];
}

/** Rayon visuel d'un disque de corps, comprimé en sqrt de sa taille. */
export function bodyVisualRadius(size: number, maxSize: number): number {
  if (maxSize <= 0) return 1.5;
  return 1.5 + (PLANET_VR - 1.5) * Math.sqrt(Math.max(0, size) / maxSize);
}

/** Direction unité d'un POI (coord brute relative au corps), corrigée de la rotation planète. */
export function coordToUnit(coord: Vec3, rotationCorrectionDeg: number): Vec3 {
  const [x, y, z] = coord;
  const len = Math.hypot(x, y, z);
  const ux = len > 1e-6 ? x / len : 0;
  const uy = len > 1e-6 ? y / len : 1;
  const uz = len > 1e-6 ? z / len : 0;
  const a = (rotationCorrectionDeg * Math.PI) / 180;
  // rotation autour de l'axe Y (longitude) pour aligner texture↔POI
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return [ux * cos - uz * sin, uy, ux * sin + uz * cos];
}

/** Point à la surface du globe de rayon `globeRadius`. */
export function surfacePoint(coord: Vec3, rotationCorrectionDeg: number, globeRadius: number): Vec3 {
  const [x, y, z] = coordToUnit(coord, rotationCorrectionDeg);
  return [x * globeRadius, y * globeRadius, z * globeRadius];
}

/** Niveau LOD selon la distance caméra→corps rapportée au rayon visuel. */
export function lodLevelFor(distToTarget: number, bodyRadius: number): "far" | "body" | "surface" {
  const r = Math.max(0.5, bodyRadius);
  if (distToTarget <= r * 2.2) return "surface";
  if (distToTarget <= r * 8) return "body";
  return "far";
}

const DEFAULT_SUN: Vec3 = [0.5, 0.5, 0.7071];

/** Direction unitaire du corps vers son étoile (lumière du globe) ; repli dessus-avant. */
export function sunDirection(body: Vec3, star: Vec3 | null): Vec3 {
  if (!star) return DEFAULT_SUN;
  const d: Vec3 = [star[0] - body[0], star[1] - body[1], star[2] - body[2]];
  const n = Math.hypot(d[0], d[1], d[2]);
  return n < 1e-6 ? DEFAULT_SUN : [d[0] / n, d[1] / n, d[2] / n];
}
