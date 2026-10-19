// État de l'itinéraire de la carte : étapes ordonnées + vaisseau choisi (portée quantique).
// Gardé dans le localStorage : l'itinéraire survit au redémarrage de l'app.
import { useEffect, useState } from "react";
import { moveStop, type ItineraryStop } from "./itinerary";

const KEY = "starmap.itinerary";
type State = { stops: ItineraryStop[]; ship: string | null };
const EMPTY: State = { stops: [], ship: null };

function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as Partial<State>) : null;
    const stops = Array.isArray(v?.stops)
      ? v.stops.filter((s): s is ItineraryStop => typeof s?.bodyId === "string").map((s) => ({ bodyId: s.bodyId, poi: s.poi ?? null }))
      : [];
    return { stops, ship: typeof v?.ship === "string" ? v.ship : null };
  } catch {
    return EMPTY;
  }
}

const same = (a: ItineraryStop, b: ItineraryStop) => a.bodyId === b.bodyId && a.poi === b.poi;

export function useItinerary() {
  const [state, setState] = useState<State>(load);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* stockage indisponible : l'itinéraire reste en mémoire */
    }
  }, [state]);
  const setStops = (f: (s: ItineraryStop[]) => ItineraryStop[]) => setState((p) => ({ ...p, stops: f(p.stops) }));
  return {
    stops: state.stops,
    ship: state.ship,
    setShip: (ship: string | null) => setState((p) => ({ ...p, ship })),
    /** Ajoute en fin (pas deux fois de suite la même étape). */
    add: (s: ItineraryStop) => setStops((l) => (l.length && same(l[l.length - 1], s) ? l : [...l, s])),
    /** Met l'étape en départ (retirée d'ailleurs). */
    start: (s: ItineraryStop) => setStops((l) => [s, ...l.filter((x) => !same(x, s))]),
    remove: (i: number) => setStops((l) => l.filter((_, j) => j !== i)),
    move: (i: number, dir: -1 | 1) => setStops((l) => moveStop(l, i, dir)),
    reverse: () => setStops((l) => l.slice().reverse()),
    clear: () => setStops(() => []),
    replace: (stops: ItineraryStop[]) => setStops(() => stops),
  };
}
export type Itinerary = ReturnType<typeof useItinerary>;
