// Contexte de la carte pour les autres onglets (Loadout, Crafting, Inventaire) : corps RSI,
// géométrie VerseTime et position du joueur, avec la distance (Gm) d'une étape depuis la
// position. Chargé une fois au montage ; rien n'est bloquant si la carte n'est pas synchronisée.
import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { parseGeo, type GeoData, type StarmapBodyItem } from "./starmapData";
import { positionBody } from "./panel";
import { legOf, stopPoint, type ItineraryStop } from "./itinerary";
import { usePlayerZone } from "./usePlayerZone";

const NO_GEO: GeoData = { systems: [], bodies: [], pois: [] };

export function useMapContext() {
  const [bodies, setBodies] = useState<StarmapBodyItem[]>([]);
  const [geo, setGeo] = useState<GeoData>(NO_GEO);
  const zone = usePlayerZone();
  useEffect(() => {
    let alive = true;
    invoke<StarmapBodyItem[]>("get_starmap_bodies")
      .then((b) => alive && setBodies(b))
      .catch(() => {});
    invoke<unknown>("starmap_geometry")
      .then((raw) => alive && setGeo(parseGeo(raw)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const here = useMemo(() => positionBody(zone, bodies), [zone, bodies]);
  const hereStop = useMemo<ItineraryStop | null>(() => (here ? { bodyId: here.id, poi: null } : null), [here]);
  /** Distance (Gm) entre deux étapes, sauts compris ; null si une position manque. */
  const dist = useCallback(
    (a: ItineraryStop, b: ItineraryStop) => legOf(stopPoint(a, bodies, geo), stopPoint(b, bodies, geo), geo, bodies).gm,
    [bodies, geo],
  );
  return { bodies, geo, here, hereStop, dist };
}
export type MapContext = ReturnType<typeof useMapContext>;
