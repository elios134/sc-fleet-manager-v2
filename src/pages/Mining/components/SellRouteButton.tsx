import { useState } from "react";
import { useNavigate } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { Route } from "lucide-react";
import { saveItineraryStops } from "../../../components/starmap3d/useItinerary";
import type { StarmapBodyItem } from "../../../components/starmap3d/starmapData";
import { sellStops } from "../lib/sellRoute";
import type { SellPoint } from "../types";

/** Étape 3 — itinéraire de vente : remplace l'itinéraire de la carte par les points de vente
 *  du raffiné (un arrêt par lieu) et ouvre la carte sur le panneau Itinéraire. */
export function SellRouteButton({ points, t }: { points: SellPoint[]; t: (k: string) => string }) {
  const navigate = useNavigate();
  const [offMap, setOffMap] = useState(false);
  const go = async () => {
    const bodies = await invoke<StarmapBodyItem[]>("get_starmap_bodies").catch(() => []);
    const stops = sellStops(points, bodies);
    if (stops.length === 0) return setOffMap(true);
    saveItineraryStops(stops);
    navigate("/starmap", { state: { panel: "route" } });
  };
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={() => void go()}
        disabled={points.length === 0}
        className="inline-flex items-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2 text-[12.5px] font-semibold text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Route className="h-4 w-4" /> {t("mining.sellRoute")}
      </button>
      {offMap && <span className="text-[12px] text-[var(--amber)]">{t("mining.sellRouteOffMap")}</span>}
    </div>
  );
}
