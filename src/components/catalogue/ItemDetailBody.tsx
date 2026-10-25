import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { ExternalLink, Loader2, ShoppingCart, Check, MapPin } from "lucide-react";
import { catLabel } from "../../lib/catalogLabels";
import { useCart } from "../../lib/useCart";
import { placeStop } from "../starmap3d/placeStop";
import type { StarmapBodyItem } from "../starmap3d/starmapData";
import { type PurchasePoint, itemIcon } from "./shared";
import { PriceCard } from "./PriceCard";
import { useItemDetail, type ItemLite } from "./useItemDetail";

const caption = "mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-white/50";

/** Lieu de vente UEX → forme attendue par placeStop. */
const shopPlace = (p: PurchasePoint) => ({
  system: p.systemName, planet: p.planetName, moon: p.moonName, station: p.spaceStationName, city: p.cityName, outpost: p.outpostName,
});

/** Fiche d'un article : image, descriptif Wiki, stats, où l'acheter (du moins cher au plus cher),
 *  ajout au panier et lieu le moins cher sur la carte. Partagée par la modale et le panneau fixe. */
export function ItemDetailBody({ item, onImage, compact = false }: { item: ItemLite; onImage?: (uuid: string, url: string) => void; compact?: boolean }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const cart = useCart();
  const { detail, loadingDetail, points } = useItemDetail(item, onImage);
  const [offMap, setOffMap] = useState(false);

  const cartKey = item.uuid ?? `id-${item.idItem}`;
  const inCart = cart.has(cartKey);
  const addToCart = () =>
    cart.add({ key: cartKey, idItem: item.idItem ?? undefined, uuid: item.uuid ?? undefined, name: item.name ?? "—", price: points?.[0]?.priceBuy ?? undefined });
  const showOnMap = async () => {
    const bodies = await invoke<StarmapBodyItem[]>("get_starmap_bodies").catch(() => []);
    const stop = points?.length ? placeStop(shopPlace(points[0]), bodies) : null;
    if (stop) navigate("/starmap", { state: { select: stop.bodyId } });
    else setOffMap(true);
  };

  const img = detail?.imageUrl ?? item.imageUrl ?? null;
  const Icon = itemIcon(item.section, item.category);
  const size = item.size ?? (detail?.size != null ? String(detail.size) : null);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={`flex w-full items-center justify-center overflow-hidden bg-gradient-to-br from-[var(--accent-muted)] to-transparent ${compact ? "h-[150px] rounded-xl" : "h-[190px]"}`}>
          {img ? <img src={img} alt="" className="h-full w-full object-contain" /> : <Icon className="h-16 w-16 text-[var(--accent)]/40" />}
        </div>

        <div className={compact ? "pt-4" : "p-5"}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-xl font-bold text-white">{item.name}</h2>
              <p className="mt-0.5 text-sm text-white/55">
                {[detail?.typeLabel ?? catLabel(item.category ?? item.section, i18n.language), detail?.manufacturer ?? item.companyName, size ? `${t("catalogue.sizeShort")}${size}` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            {detail?.webUrl && (
              <button type="button" onClick={() => void openUrl(detail.webUrl as string).catch(() => {})} className="mt-0.5 inline-flex shrink-0 items-center gap-1 text-[11.5px] text-[var(--accent)] hover:underline">
                {t("catalogue.openWiki")} <ExternalLink className="h-3 w-3" />
              </button>
            )}
          </div>

          {loadingDetail ? (
            <div className="flex items-center gap-2 py-4 text-sm text-white/40">
              <Loader2 className="h-4 w-4 animate-spin" /> {t("catalogue.loading")}
            </div>
          ) : (
            <>
              {detail?.description && <p className="mt-3 whitespace-pre-line text-[13px] leading-relaxed text-white/70">{detail.description}</p>}
              {detail && detail.stats.length > 0 && (
                <div className="mt-4">
                  <p className={caption}>{t("catalogue.stats")}</p>
                  <div className="grid grid-cols-2 gap-x-5 gap-y-1">
                    {detail.stats.map((s, i) => (
                      <div key={i} className="flex items-center justify-between gap-2 py-0.5 text-[13px]">
                        <span className="truncate text-white/50">{s.name}</span>
                        <span className="shrink-0 font-medium tabular-nums text-white/90">{s.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          <div className="mt-5">
            <p className={caption}>{t("catalogue.whereToBuy")}</p>
            {points == null ? (
              <div className="flex items-center gap-2 py-2 text-sm text-white/40">
                <Loader2 className="h-4 w-4 animate-spin" /> {t("catalogue.loading")}
              </div>
            ) : points.length === 0 ? (
              <p className="py-2 text-sm text-white/40">{t("catalogue.noPurchase")}</p>
            ) : (
              <div className="flex flex-col gap-2">
                {points.map((p, i) => (
                  <PriceCard key={i} p={p} price={p.priceBuy} best={i === 0 && points.length > 1} t={t} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className={`shrink-0 border-t border-white/10 ${compact ? "pt-3" : "p-4"}`}>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={addToCart}
            disabled={inCart}
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors ${
              inCart ? "border border-emerald-400/30 bg-emerald-400/10 text-emerald-300" : "bg-[var(--accent)] text-white hover:brightness-110"
            }`}
          >
            {inCart ? <Check className="h-4 w-4" /> : <ShoppingCart className="h-4 w-4" />}
            {inCart ? t("cart.added") : t("cart.add")}
          </button>
          <button
            type="button"
            onClick={() => void showOnMap()}
            disabled={!points?.length}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/10 disabled:opacity-45"
          >
            <MapPin className="h-4 w-4" /> {t("catalogue.showOnMap")}
          </button>
        </div>
        {offMap && <p className="mt-2 text-[11.5px] text-white/45">{t("catalogue.offMap")}</p>}
      </div>
    </div>
  );
}
