// Où acheter les composants d'un loadout (logique pure, testée) : rattachement d'une offre UEX
// à un lieu de la carte, meilleure offre selon le tri, liste d'achats → total, arrêts et
// itinéraire de la carte.
import { bodyKey } from "../../../components/starmap3d/naming";
import { safeName, type StarmapBodyItem } from "../../../components/starmap3d/starmapData";
import { itineraryFrom, type ItineraryStop } from "../../../components/starmap3d/itinerary";
import { gradeRank } from "../helpers";

/** Offre UEX d'un composant (commande `get_component_offers`). */
export type Offer = {
  className: string;
  terminal: string;
  price: number;
  system: string | null;
  planet: string | null;
  moon: string | null;
  station: string | null;
  city: string | null;
  outpost: string | null;
};
/** Offre rattachée à la carte : étape d'itinéraire et distance depuis la position (Gm). */
export type PlacedOffer = Offer & { stop: ItineraryStop | null; gm: number | null };
export type OfferSort = "nearest" | "cheapest" | "best";
/** Ligne de la liste d'achats (une par emplacement du vaisseau). */
export type CartLine = {
  slot: string;
  className: string;
  name: string;
  terminal: string;
  place: string;
  price: number;
  stop: ItineraryStop | null;
};

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && w !== "station");
/** Même station sous deux noms : les mots du plus court sont tous dans le plus long. */
function sameStation(a: string, b: string): boolean {
  const [wa, wb] = [words(a), words(b)];
  const [short, long] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
  return short.length > 0 && short.every((w) => long.includes(w));
}

/** Étape de la carte d'une offre : la station elle-même, sinon la ville / l'avant-poste comme
 *  POI de sa lune ou planète. null si le lieu n'existe pas sur la carte. */
export function offerStop(o: Offer, bodies: StarmapBodyItem[]): ItineraryStop | null {
  const system = (o.system ?? "").toLowerCase();
  const inSystem = bodies.filter((b) => !system || b.systemName.toLowerCase() === system);
  const station = (name: string | null) => (name ? inSystem.find((b) => b.navIcon === "Station" && sameStation(safeName(b), name)) : undefined);
  const st = station(o.station);
  if (st) return { bodyId: st.id, poi: null };
  const host = (name: string | null, icon: string) => (name ? inSystem.find((b) => b.navIcon === icon && bodyKey(safeName(b)) === bodyKey(name)) : undefined);
  const body = host(o.moon, "Moon") ?? host(o.planet, "Planet");
  if (body) return { bodyId: body.id, poi: o.city ?? o.outpost ?? null };
  // Ville sans planète chez UEX (Levski) : c'est une station de la carte.
  const city = station(o.city);
  return city ? { bodyId: city.id, poi: null } : null;
}

/** Libellé de lieu d'une offre (« New Babbage · microTech »). */
export const offerPlace = (o: Offer) => [o.station ?? o.city ?? o.outpost, o.moon ?? o.planet].filter(Boolean).join(" · ");

const byPrice = (a: PlacedOffer, b: PlacedOffer) => a.price - b.price;
const byDistance = (a: PlacedOffer, b: PlacedOffer) => (a.gm ?? Infinity) - (b.gm ?? Infinity) || byPrice(a, b);

/** Offre retenue pour un composant : la plus proche (sinon la moins chère), ou la moins chère. */
export function bestOffer(offers: PlacedOffer[], sort: OfferSort): PlacedOffer | null {
  if (!offers.length) return null;
  return offers.slice().sort(sort === "nearest" ? byDistance : byPrice)[0];
}

/** Composants triés par leur offre retenue ; « meilleur » = grade puis prix. Non vendus en fin. */
export function sortComponents<T extends { grade: string | null }>(rows: T[], offerOf: (c: T) => PlacedOffer | null, sort: OfferSort): T[] {
  const key = (c: T) => {
    const o = offerOf(c);
    return sort === "nearest" ? (o?.gm ?? Infinity) : (o?.price ?? Infinity);
  };
  return rows
    .map((c, i) => ({ c, i }))
    .sort((a, b) => {
      if (sort === "best") {
        const g = (gradeRank(b.c.grade) ?? 0) - (gradeRank(a.c.grade) ?? 0);
        if (g) return g;
      }
      const ka = key(a.c);
      const kb = key(b.c);
      return ka === kb ? (offerOf(a.c)?.price ?? Infinity) - (offerOf(b.c)?.price ?? Infinity) || a.i - b.i : ka < kb ? -1 : 1;
    })
    .map((x) => x.c);
}

/** Total de la liste et nombre d'arrêts (un par terminal). */
export function cartSummary(lines: CartLine[]): { total: number; stops: number } {
  return { total: lines.reduce((a, l) => a + l.price, 0), stops: new Set(lines.map((l) => `${l.terminal}|${l.place}`)).size };
}

/** Itinéraire d'achats : départ (position), puis un arrêt par lieu de la carte, au plus proche. */
export function cartItinerary(
  lines: CartLine[],
  start: ItineraryStop | null,
  dist: (a: ItineraryStop, b: ItineraryStop) => number | null,
): ItineraryStop[] {
  return itineraryFrom(start, lines.map((l) => l.stop), dist);
}
