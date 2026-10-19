// Mise en page de la carte : placement orbital des corps d'un système (champs RSI), anneaux,
// nœuds de la galaxie. Pur (pas de rendu).
import { GALAXY_POSITIONS, GALAXY_LINKS, SYSTEM_COLORS, SYSTEM_NAMES, type StarmapBodyItem } from "./starmapData";
import { orbitRadius, placeOnPlane, bodyVisualRadius, TILT_DEG, type Vec3 } from "./placement";
import { bodyJoinKey, parentJoinKey } from "./panel";

export const TILT = (TILT_DEG * Math.PI) / 180;
const GAL_SCALE = 0.18;

export type Kind = "star" | "planet" | "moon" | "station" | "jump" | "belt";
export type Placed = { body: StarmapBodyItem; pos: Vec3; radius: number; kind: Kind; ringR?: number };


/** Place tous les corps d'un système directement depuis les champs orbitaux RSI. */
export function layoutSystem(bodies: StarmapBodyItem[], systemId: string): Placed[] {
  const list = bodies.filter((b) => b.systemName === systemId && !b.hideInStarmap);
  const star = list.find((b) => b.navIcon === "Star") ?? null;
  const out: Placed[] = [];
  if (star) out.push({ body: star, pos: [0, 0, 0], radius: 7, kind: "star" });

  const planets = list.filter((b) => b.navIcon === "Planet");
  const maxD = Math.max(1, ...planets.map((p) => p.distance ?? 0));
  const maxSize = Math.max(1, ...planets.map((p) => p.size ?? 0));
  const angleFallback = (i: number, n: number) => (n ? (i / n) * 360 : 0);

  planets.forEach((p, i) => {
    const R = orbitRadius(p.distance ?? ((i + 1) / planets.length) * maxD, maxD);
    const lon = p.longitude ?? angleFallback(i, planets.length);
    const pos = placeOnPlane(R, lon);
    const radius = bodyVisualRadius(p.size ?? 0, maxSize);
    out.push({ body: p, pos, radius, kind: "planet", ringR: R });

    const kids = list.filter((c) => parentJoinKey(c) === bodyJoinKey(p));
    const moons = kids.filter((c) => c.navIcon === "Moon");
    const stations = kids.filter((c) => c.navIcon === "Station");
    moons.forEach((m, j) => {
      const rr = radius * (moons.length === 1 ? 3 : 2.4 + (2.6 * j) / Math.max(1, moons.length - 1));
      const local = placeOnPlane(rr, m.longitude ?? j * 70);
      const mPos: Vec3 = [pos[0] + local[0], pos[1] + local[1], pos[2] + local[2]];
      const mRadius = Math.max(0.7, radius * 0.34);
      out.push({ body: m, pos: mPos, radius: mRadius, kind: "moon", ringR: rr });
      // Stations d'une lune (Grim HEX, relais…) : petit cercle autour de la lune.
      const mKids = list.filter((c) => c.navIcon === "Station" && parentJoinKey(c) === bodyJoinKey(m));
      mKids.forEach((s, k) => {
        const l = placeOnPlane(mRadius * 1.8, k * 70 + 35);
        out.push({ body: s, pos: [mPos[0] + l[0], mPos[1] + l[1], mPos[2] + l[2]], radius: 0, kind: "station" });
      });
    });
    stations.forEach((s, j) => {
      const rr = radius * (stations.length === 1 ? 1.9 : 1.7 + (0.9 * j) / Math.max(1, stations.length - 1));
      const local = placeOnPlane(rr, s.longitude ?? j * 55 + 20);
      out.push({
        body: s,
        pos: [pos[0] + local[0], pos[1] + local[1], pos[2] + local[2]],
        radius: 0,
        kind: "station",
      });
    });
  });

  // Stations en orbite de l'étoile (Lagrange, Gateways…) : placées comme une planète.
  if (star) {
    list
      .filter((b) => b.navIcon === "Station" && parentJoinKey(b) === bodyJoinKey(star) && b.distance != null)
      .forEach((s, i) => {
        const pos = placeOnPlane(orbitRadius(s.distance!, maxD), s.longitude ?? i * 40);
        out.push({ body: s, pos, radius: 0, kind: "station" });
      });
  }

  list
    .filter((b) => b.navIcon === "AsteroidBelt")
    .forEach((belt) => {
      const R = orbitRadius(belt.distance ?? maxD * 0.6, maxD);
      out.push({ body: belt, pos: [0, 0, 0], radius: 0, kind: "belt", ringR: R });
    });
  list
    .filter((b) => b.navIcon === "Jumppoint")
    .forEach((jp, i) => {
      const R = orbitRadius(jp.distance ?? maxD, maxD);
      out.push({ body: jp, pos: placeOnPlane(R, jp.longitude ?? i * 50), radius: 0, kind: "jump" });
    });
  return out;
}

/** Anneau (128 segments) dans le plan écliptique tilté, centré à `center`. */
export function ringPoints(R: number, center: Vec3 = [0, 0, 0]): Float32Array {
  const seg = 128;
  const arr: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const x = R * Math.cos(a);
    const z = R * Math.sin(a);
    arr.push(center[0] + x, center[1] - z * Math.sin(TILT), center[2] + z * Math.cos(TILT));
  }
  return new Float32Array(arr);
}

export function galaxyData(bodies: StarmapBodyItem[]) {
  const systems = [...new Set(bodies.map((b) => b.systemName))];
  const nodes = systems.map((s) => {
    const k = s.toLowerCase();
    const gp = GALAXY_POSITIONS[k] ?? { gx: 0, gy: 0 };
    return {
      id: s,
      name: SYSTEM_NAMES[k] ?? s.toUpperCase(),
      color: SYSTEM_COLORS[k] ?? "#f5a623",
      pos: [gp.gx * GAL_SCALE, 0, gp.gy * GAL_SCALE] as Vec3,
    };
  });
  const posOf = (id: string) => nodes.find((n) => n.id.toLowerCase() === id.toLowerCase())?.pos ?? null;
  const links = GALAXY_LINKS.map(([a, b]) => [posOf(a), posOf(b)]).filter(
    (l): l is [Vec3, Vec3] => l[0] != null && l[1] != null,
  );
  return { nodes, links };
}
