// Où acheter les composants d'un loadout (logique pure, testée) : rattachement d'une offre UEX
// à un lieu de la carte, meilleure offre selon le tri, liste d'achats → total, arrêts et
// itinéraire de la carte.
import { type StarmapBodyItem } from "../../../components/starmap3d/starmapData";
import { placeStop } from "../../../components/starmap3d/placeStop";
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

/** Étape de la carte d'une offre (voir placeStop). */
export const offerStop = (o: Offer, bodies: StarmapBodyItem[]): ItineraryStop | null => placeStop(o, bodies);

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
