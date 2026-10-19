// Itinéraire multi-étapes de la carte (logique pure, testée) : position réelle des étapes
// (coordonnées VerseTime, km), distance des étapes (passage par les points de saut entre
// systèmes), carburant quantique, optimisation de l'ordre.
import { safeName, type GeoData, type StarmapBodyItem } from "./starmapData";
import { bodyKey } from "./naming";
import { bodyJoinKey, parentJoinKey } from "./panel";
import type { Vec3 } from "./placement";

/** Une étape : un corps de la carte, ou un lieu de surface (POI) de ce corps. */
export type ItineraryStop = { bodyId: string; poi: string | null };
export type StopPoint = { system: string; km: Vec3 };
export type Leg = { gm: number | null; jump: string | null };
export type FuelState = "ok" | "refuel" | "tooFar" | null;

const geoByKey = (geo: GeoData, key: string) => geo.bodies.find((g) => bodyKey(g.name) === key);

/** Coordonnées réelles (km) d'une étape ; null si la géométrie ne la connaît pas. */
export function stopPoint(stop: ItineraryStop, bodies: StarmapBodyItem[], geo: GeoData): StopPoint | null {
  const body = bodies.find((b) => b.id === stop.bodyId);
  if (!body) return null;
  const system = body.systemName.toLowerCase();
  if (stop.poi) {
    const poi = geo.pois.find((p) => p.name === stop.poi);
    const parent = poi ? geoByKey(geo, bodyKey(poi.parentBody)) : undefined;
    if (poi && parent) {
      return { system, km: [parent.coord[0] + poi.coord[0], parent.coord[1] + poi.coord[1], parent.coord[2] + poi.coord[2]] };
    }
  }
  let cur: StarmapBodyItem | undefined = body;
  for (let depth = 0; cur && depth < 3; depth++) {
    const name = safeName(cur);
    const direct = geoByKey(geo, bodyKey(name)) ?? (cur.navIcon === "Jumppoint" ? geoByKey(geo, bodyKey(name) + "jp") : undefined);
    if (direct) return { system, km: direct.coord };
    // Station de Lagrange : « HUR-L2 Faithful Dream Station » → point « HUR-L2 ».
    const lag = /^([A-Z]{3})-L([1-5])\b/.exec(name);
    const lagGeo = lag ? geoByKey(geo, bodyKey(`${lag[1]}-L${lag[2]}`)) : undefined;
    if (lagGeo) return { system, km: lagGeo.coord };
    // Sinon le corps parent (station autour d'une planète / lune) ; jamais l'étoile.
    const parentKey = parentJoinKey(cur);
    const parent = bodies.find((b) => bodyJoinKey(b) === parentKey);
    if (!parent || parent.navIcon === "Star") return null;
    cur = parent;
  }
  return null;
}

const gmBetween = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / 1e6;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Point de saut du système `from` qui mène à `to` (géométrie VerseTime). */
function jumpIn(geo: GeoData, from: string, to: string) {
  return geo.bodies.find(
    (g) => g.type === "Jump Point" && (g.parentStar ?? "").toLowerCase() === from && bodyKey(g.name).includes(bodyKey(to)),
  );
}

/** Distance d'une étape (Gm) ; entre deux systèmes, via les points de saut des deux côtés. */
export function legOf(a: StopPoint | null, b: StopPoint | null, geo: GeoData): Leg {
  if (!a || !b) return { gm: null, jump: null };
  if (a.system === b.system) return { gm: gmBetween(a.km, b.km), jump: null };
  const jump = `${cap(a.system)} – ${cap(b.system)}`;
  const out = jumpIn(geo, a.system, b.system);
  const into = jumpIn(geo, b.system, a.system);
  return { gm: out && into ? gmBetween(a.km, out.coord) + gmBetween(into.coord, b.km) : null, jump };
}

/** État carburant de chaque étape avec une portée quantique (Gm) : ok, ravitailler avant,
 *  ou trop loin même plein. Distance inconnue → null (la réserve n'est pas modifiée). */
export function fuelLegs(gms: (number | null)[], rangeGm: number | null): FuelState[] {
  if (rangeGm == null || rangeGm <= 0) return gms.map(() => null);
  let left = rangeGm;
  return gms.map((gm) => {
    if (gm == null) return null;
    if (gm > rangeGm) {
      left = rangeGm;
      return "tooFar";
    }
    if (gm > left) {
      left = rangeGm - gm;
      return "refuel";
    }
    left -= gm;
    return "ok";
  });
}

/** Ordre « au plus proche » en gardant le départ ; les étapes sans distance connue à la fin. */
export function optimizeOrder<T>(items: T[], dist: (a: T, b: T) => number | null): T[] {
  if (items.length < 3) return items;
  const rest = items.slice(1);
  const out = [items[0]];
  while (rest.length) {
    const from = out[out.length - 1];
    let best = -1;
    let bestD = Infinity;
    rest.forEach((x, i) => {
      const d = dist(from, x);
      if (d != null && d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best < 0) break;
    out.push(rest.splice(best, 1)[0]);
  }
  return [...out, ...rest];
}

/** Déplace l'élément `i` d'un cran (`dir` = -1 monte, +1 descend), borné aux extrémités. */
export function moveStop<T>(list: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (i < 0 || i >= list.length || j < 0 || j >= list.length) return list;
  const out = list.slice();
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}
