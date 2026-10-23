import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { Route, X } from "lucide-react";
import { appLocale } from "../../../lib/format";
import { saveItineraryStops } from "../../../components/starmap3d/useItinerary";
import type { MapContext } from "../../../components/starmap3d/useMapContext";
import { cartItinerary, cartSummary } from "../lib/shopping";
import type { ShoppingCart } from "../hooks/useShoppingCart";

const fmt = (n: number) => Math.round(n).toLocaleString(appLocale());

/** Liste d'achats du vaisseau : un composant par emplacement, total, arrêts, et création de
 *  l'itinéraire d'achats sur la carte (départ = position, ordre au plus proche). */
export function ShoppingListPanel({ cart, map }: { cart: ShoppingCart; map: MapContext }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { total, stops } = cartSummary(cart.lines);
  const toMap = () => {
    saveItineraryStops(cartItinerary(cart.lines, map.hereStop, map.dist));
    navigate("/starmap", { state: { panel: "route" } });
  };
  return (
    <section className="glass mb-4 flex flex-col gap-2 rounded-2xl px-4 py-3.5" aria-label={t("loadout.cart.title")}>
      <h3 className="text-xs font-bold uppercase tracking-[0.08em] text-white/60">{t("loadout.cart.title")}</h3>
      {cart.lines.length === 0 ? (
        <p className="text-[12px] text-white/45">{t("loadout.cart.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {cart.lines.map((l) => (
            <li key={l.slot} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.025] px-2.5 py-1.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] font-semibold text-white">{l.name}</p>
                <p className="truncate text-[10.5px] text-white/40">{[l.terminal, l.place].filter(Boolean).join(" · ")}</p>
              </div>
              <span className="font-mono text-[12px] tabular-nums text-white/80">{fmt(l.price)}</span>
              <button type="button" onClick={() => cart.remove(l.slot)} aria-label={t("loadout.offer.remove")} className="rounded p-0.5 text-white/40 hover:bg-white/10 hover:text-white">
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex justify-between border-t border-white/10 pt-2 text-[12.5px] font-bold text-white">
        {t("loadout.cart.total")}
        <span className="font-mono tabular-nums">{fmt(total)} aUEC</span>
      </div>
      <div className="flex justify-between text-[12px] text-white/50">
        {t("loadout.cart.stops")}
        <span className="font-mono">{stops}</span>
      </div>
      <button
        type="button"
        disabled={cart.lines.length === 0}
        onClick={toMap}
        className="mt-1 flex items-center justify-center gap-2 rounded-[10px] bg-[var(--accent)] px-3 py-2 text-[12.5px] font-semibold text-white hover:brightness-110 disabled:opacity-50"
      >
        <Route className="h-4 w-4" />
        {t("loadout.cart.toMap")}
      </button>
      <p className="text-[10.5px] text-white/35">{map.here ? t("loadout.cart.toMapHint") : t("loadout.cart.toMapNoPos")}</p>
    </section>
  );
}
