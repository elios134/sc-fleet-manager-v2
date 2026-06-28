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
