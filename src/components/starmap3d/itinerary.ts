// Itinéraire multi-étapes de la carte (logique pure, testée) : position réelle des étapes
// (coordonnées VerseTime, km ; estimée depuis la carte RSI dans un système sans géométrie,
// ex. Nyx), distance des étapes (deux moitiés via les points de saut entre systèmes),
// carburant quantique par moitié, optimisation de l'ordre.
import { safeName, type GeoData, type StarmapBodyItem } from "./starmapData";
import { bodyKey } from "./naming";
import { bodyJoinKey, parentJoinKey } from "./panel";
import type { Vec3 } from "./placement";

/** Une étape : un corps de la carte, ou un lieu de surface (POI) de ce corps. */
export type ItineraryStop = { bodyId: string; poi: string | null };
/** Système de l'étape et coordonnées (km) ; km null si la position est inconnue,
 *  `estimated` quand elles viennent de la carte RSI (échelle approchée). */
export type StopPoint = { system: string; km: Vec3 | null; estimated?: true };
/** Étape : distance totale (null si une partie est inconnue) ; entre deux systèmes, `parts`
 *  = [jusqu'au point de saut, depuis le point de saut d'arrivée]. */
export type Leg = { gm: number | null; jump: string | null; parts: [number | null, number | null] | null; estimated: boolean };
export type FuelState = "ok" | "refuel" | "tooFar" | null;

/** Une unité de distance de la carte RSI ≈ 14,96 Gm (Hurston, Crusader, ArcCorp concordent). */
export const RSI_UNIT_KM = 14.96e6;

/** Le système a-t-il une géométrie VerseTime (sinon : estimation RSI) ? */
const hasGeometry = (geo: GeoData, system: string) =>
  geo.bodies.some((g) => (g.parentStar ?? g.name).toLowerCase() === system);

/** Position estimée d'un corps RSI (ou de son premier parent positionné). */
function estimated(body: StarmapBodyItem, bodies: StarmapBodyItem[]): Vec3 | null {
  let cur: StarmapBodyItem | undefined = body;
  for (let depth = 0; cur && depth < 3; depth++) {
    if (cur.posX != null && cur.posY != null) return [cur.posX * RSI_UNIT_KM, cur.posY * RSI_UNIT_KM, (cur.posZ ?? 0) * RSI_UNIT_KM];
    const parentKey = parentJoinKey(cur);
    cur = bodies.find((b) => bodyJoinKey(b) === parentKey);
  }
  return null;
}

const geoByKey = (geo: GeoData, key: string) => geo.bodies.find((g) => bodyKey(g.name) === key);

/** Coordonnées réelles (km) d'une étape ; km null si inconnues, null si le corps n'existe plus. */
export function stopPoint(stop: ItineraryStop, bodies: StarmapBodyItem[], geo: GeoData): StopPoint | null {
  const body = bodies.find((b) => b.id === stop.bodyId);
  if (!body) return null;
  const system = body.systemName.toLowerCase();
  if (!hasGeometry(geo, system)) {
    const km = estimated(body, bodies);
    return km ? { system, km, estimated: true } : { system, km: null };
  }
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
    // Station Wiki : coordonnées réelles enregistrées à la synchro.
    if (cur.realX != null && cur.realY != null) return { system, km: [cur.realX, cur.realY, cur.realZ ?? 0] };
    // Sinon le corps parent (station autour d'une planète / lune) ; jamais l'étoile.
    const parentKey = parentJoinKey(cur);
    const parent = bodies.find((b) => bodyJoinKey(b) === parentKey);
    if (!parent || parent.navIcon === "Star") break;
    cur = parent;
  }
  return { system, km: null };
}

const gmBetween = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / 1e6;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Point de saut du système `from` qui mène à `to` (géométrie VerseTime). */
function jumpIn(geo: GeoData, from: string, to: string) {
  return geo.bodies.find(
    (g) => g.type === "Jump Point" && (g.parentStar ?? "").toLowerCase() === from && bodyKey(g.name).includes(bodyKey(to)),
  );
}

/** Position du point de saut de `from` vers `to` : géométrie VerseTime, sinon carte RSI. */
function jumpPoint(geo: GeoData, bodies: StarmapBodyItem[], from: string, to: string): { km: Vec3; estimated: boolean } | null {
  if (hasGeometry(geo, from)) {
    const g = jumpIn(geo, from, to);
    return g ? { km: g.coord, estimated: false } : null;
  }
  const jp = bodies.find((b) => b.navIcon === "Jumppoint" && b.systemName.toLowerCase() === from && bodyKey(safeName(b)).includes(bodyKey(to)));
  const km = jp ? estimated(jp, bodies) : null;
  return km ? { km, estimated: true } : null;
}

/** Distance d'une étape (Gm) ; entre deux systèmes, deux moitiés via les points de saut. */
export function legOf(a: StopPoint | null, b: StopPoint | null, geo: GeoData, bodies: StarmapBodyItem[]): Leg {
  if (!a || !b) return { gm: null, jump: null, parts: null, estimated: false };
  const est = !!a.estimated || !!b.estimated;
  if (a.system === b.system) return { gm: a.km && b.km ? gmBetween(a.km, b.km) : null, jump: null, parts: null, estimated: est };
  const jump = `${cap(a.system)} – ${cap(b.system)}`;
  const out = jumpPoint(geo, bodies, a.system, b.system);
  const into = jumpPoint(geo, bodies, b.system, a.system);
  const p1 = a.km && out ? gmBetween(a.km, out.km) : null;
  const p2 = b.km && into ? gmBetween(into.km, b.km) : null;
  return {
    gm: p1 != null && p2 != null ? p1 + p2 : null,
    jump,
    parts: [p1, p2],
    estimated: est || !!out?.estimated || !!into?.estimated,
  };
}

const SEVERITY: Record<Exclude<FuelState, null>, number> = { ok: 0, refuel: 1, tooFar: 2 };

/** Carburant quantique de chaque étape avec une portée (Gm) : ok, ravitailler avant, ou trop
 *  loin même plein. Entre deux systèmes, chaque moitié est vérifiée et le réservoir est refait
 *  à la Gateway. Distance inconnue → null (la réserve n'est pas modifiée). */
export function fuelPlan(
  legs: { gm: number | null; parts: [number | null, number | null] | null }[],
  rangeGm: number | null,
): { leg: FuelState; parts: [FuelState, FuelState] | null }[] {
  if (rangeGm == null || rangeGm <= 0) return legs.map(() => ({ leg: null, parts: null }));
  let left = rangeGm;
  const hop = (gm: number | null): FuelState => {
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
  };
  return legs.map((l) => {
    if (!l.parts) return { leg: hop(l.gm), parts: null };
    const first = hop(l.parts[0]);
    left = rangeGm; // plein possible à la Gateway, entre les deux sauts
    const second = hop(l.parts[1]);
    const worst = [first, second].filter((x): x is Exclude<FuelState, null> => x != null).sort((x, y) => SEVERITY[y] - SEVERITY[x])[0] ?? null;
    return { leg: worst, parts: [first, second] };
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

/** Itinéraire tout prêt depuis un autre onglet : départ (position), puis chaque lieu une seule
 *  fois, au plus proche. Les étapes nulles (lieu absent de la carte) sont omises. */
export function itineraryFrom(
  start: ItineraryStop | null,
  stops: (ItineraryStop | null)[],
  dist: (a: ItineraryStop, b: ItineraryStop) => number | null,
): ItineraryStop[] {
  const seen = new Set<string>();
  const out: ItineraryStop[] = [];
  for (const s of [start, ...stops]) {
    const k = s && `${s.bodyId}|${s.poi ?? ""}`;
    if (!s || !k || seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return optimizeOrder(out, dist);
}

/** Déplace l'élément `i` d'un cran (`dir` = -1 monte, +1 descend), borné aux extrémités. */
export function moveStop<T>(list: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (i < 0 || i >= list.length || j < 0 || j >= list.length) return list;
  const out = list.slice();
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}
