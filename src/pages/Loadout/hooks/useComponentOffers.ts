// Offres d'achat des composants affichés dans le sélecteur, rattachées à la carte : étape
// d'itinéraire et distance (Gm) depuis la position du joueur.
import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { MapContext } from "../../../components/starmap3d/useMapContext";
import { offerStop, type Offer, type PlacedOffer } from "../lib/shopping";

export function useComponentOffers(classNames: string[], map: MapContext) {
  const [raw, setRaw] = useState<{ className: string; offers: Offer[] }[]>([]);
  const ids = classNames.join("|");
  useEffect(() => {
    let alive = true;
    const list = ids ? ids.split("|") : [];
    if (!list.length) return;
    invoke<{ className: string; offers: Offer[] }[]>("get_component_offers", { classNames: list })
      .then((r) => alive && setRaw(r))
      .catch(() => alive && setRaw([]));
    return () => {
      alive = false;
    };
  }, [ids]);
  const { bodies, hereStop, dist } = map;
  return useMemo(() => {
    const out = new Map<string, PlacedOffer[]>();
    for (const r of raw) {
      out.set(
        r.className,
        r.offers.map((o) => {
          const stop = offerStop(o, bodies);
          return { ...o, stop, gm: stop && hereStop ? dist(hereStop, stop) : null };
        }),
      );
    }
    return out;
  }, [raw, bodies, hereStop, dist]);
}
