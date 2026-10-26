import { placeStop } from "../../../components/starmap3d/placeStop";
import type { ItineraryStop } from "../../../components/starmap3d/itinerary";
import type { StarmapBodyItem } from "../../../components/starmap3d/starmapData";
import type { SellPoint } from "../types";

/** Arrêts de l'itinéraire de vente : un par point de vente qu'on sait placer sur la carte,
 *  dans l'ordre donné, sans doublon (deux minéraux vendus au même endroit = un arrêt). */
export function sellStops(points: SellPoint[], bodies: StarmapBodyItem[]): ItineraryStop[] {
  const stops: ItineraryStop[] = [];
  for (const p of points) {
    const stop = p.place ? placeStop(p.place, bodies) : null;
    if (stop && !stops.some((s) => s.bodyId === stop.bodyId && s.poi === stop.poi)) stops.push(stop);
  }
  return stops;
}
