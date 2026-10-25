// Rattachement d'un lieu de vente UEX (système, planète, lune, station, ville, avant-poste) à une
// étape de la carte. Logique pure, partagée par le Loadout (offres) et le Catalogue (points de vente).
import { bodyKey } from "./naming";
import { safeName, type StarmapBodyItem } from "./starmapData";
import type { ItineraryStop } from "./itinerary";

export type ShopPlace = {
  system: string | null;
  planet: string | null;
  moon: string | null;
  station: string | null;
  city: string | null;
  outpost: string | null;
};

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && w !== "station");
/** Même station sous deux noms : les mots du plus court sont tous dans le plus long. */
function sameStation(a: string, b: string): boolean {
  const [wa, wb] = [words(a), words(b)];
  const [short, long] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
  return short.length > 0 && short.every((w) => long.includes(w));
}

/** Étape de la carte d'un lieu : la station elle-même, sinon la ville / l'avant-poste comme
 *  POI de sa lune ou planète. null si le lieu n'existe pas sur la carte. */
export function placeStop(o: ShopPlace, bodies: StarmapBodyItem[]): ItineraryStop | null {
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
