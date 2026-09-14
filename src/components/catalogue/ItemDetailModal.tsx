import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import { X, ExternalLink, Loader2, ShoppingCart, Check } from "lucide-react";
import { catLabel } from "../../lib/catalogLabels";
import { useCart } from "../../lib/useCart";
import { type PurchasePoint, itemIcon } from "./shared";
import { PriceCard } from "./PriceCard";

type ItemLite = {
  idItem: number | null;
  uuid: string | null;
  name: string | null;
  section: string | null;
  category: string | null;
  companyName?: string | null;
  size?: string | null;
  imageUrl?: string | null;
};
type ItemStat = { name: string; value: string };
type ItemWikiDetail = {
  available: boolean;
  description: string | null;
  manufacturer: string | null;
  typeLabel: string | null;
  subTypeLabel: string | null;
  size: number | null;
  grade: string | null;
  webUrl: string | null;
  imageUrl: string | null;
  stats: ItemStat[];
};

// Modale de détail d'un article : image + descriptif Wiki + stats + où acheter + panier.
// `onImage` remonte l'image trouvée (Wiki) pour l'afficher ensuite dans la liste.
export function ItemDetailModal({
  item,
  onClose,
  onImage,
}: {
  item: ItemLite;
  onClose: () => void;
  onImage?: (uuid: string, url: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const cart = useCart();
  const [detail, setDetail] = useState<ItemWikiDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [points, setPoints] = useState<PurchasePoint[] | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let alive = true;
    setPoints(null);
    invoke<PurchasePoint[]>("get_item_purchase_points", { idItem: item.idItem, uuid: item.uuid })
      .then((p) => alive && setPoints(p))
      .catch(() => alive && setPoints([]));
    if (!item.uuid) { setDetail({ available: false, description: null, manufacturer: null, typeLabel: null, subTypeLabel: null, size: null, grade: null, webUrl: null, imageUrl: null, stats: [] }); return; }
    setLoadingDetail(true);
    invoke<ItemWikiDetail>("get_item_wiki_detail", { uuid: item.uuid })
      .then((d) => {
        if (!alive) return;
        setDetail(d);
        if (d.imageUrl && item.uuid) onImage?.(item.uuid, d.imageUrl);
      })
      .catch(() => alive && setDetail(null))
      .finally(() => alive && setLoadingDetail(false));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.idItem, item.uuid]);

  const cartKey = item.uuid ?? `id-${item.idItem}`;
  const inCart = cart.has(cartKey);
  function addToCart() {
    const cheapest = points && points.length ? points[0]?.priceBuy ?? undefined : undefined;
    cart.add({ key: cartKey, idItem: item.idItem ?? undefined, uuid: item.uuid ?? undefined, name: item.name ?? "—", price: cheapest });
  }

  const img = detail?.imageUrl ?? item.imageUrl ?? null;
  const Icon = itemIcon(item.section, item.category);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative z-10 flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-white/12 bg-[#0f0f16] shadow-2xl">
        <button
          ref={closeRef}
          onClick={onClose}
          aria-label={t("cart.close")}
          className="absolute right-3 top-3 z-10 grid h-8 w-8 place-items-center rounded-lg bg-black/40 text-white/60 hover:bg-black/60 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* Bandeau image */}
          <div
            className="flex h-[190px] w-full items-center justify-center overflow-hidden"
            style={{ background: "linear-gradient(135deg,rgba(99,102,241,.20),rgba(139,92,246,.08))" }}
          >
            {img ? <img src={img} alt="" className="h-full w-full object-contain" /> : <Icon className="h-16 w-16 text-[var(--accent)]/40" />}
          </div>

          <div className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-xl font-bold text-white">{item.name}</h2>
                <p className="mt-0.5 text-sm text-white/55">
                  {[
                    detail?.typeLabel ?? catLabel(item.category ?? item.section, lang),
                    detail?.manufacturer ?? item.companyName,
                    item.size ? `${t("catalogue.sizeShort")}${item.size}` : detail?.size ? `${t("catalogue.sizeShort")}${detail.size}` : null,
                  ].filter(Boolean).join(" · ")}
                </p>
              </div>
              {detail?.webUrl && (
                <button
                  type="button"
                  onClick={() => void openUrl(detail.webUrl as string).catch(() => {})}
                  className="mt-0.5 inline-flex shrink-0 items-center gap-1 text-[11.5px] text-[var(--accent)] hover:underline"
                >
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
                {detail?.description && (
                  <p className="mt-3 whitespace-pre-line text-[13px] leading-relaxed text-white/70">{detail.description}</p>
                )}
                {detail && detail.stats.length > 0 && (
                  <div className="mt-4">
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-white/50">{t("catalogue.stats")}</p>
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

            {/* Où acheter */}
            <div className="mt-5">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-white/50">{t("catalogue.whereToBuy")}</p>
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

        <div className="shrink-0 border-t border-white/10 p-4">
          <button
            onClick={addToCart}
            disabled={inCart}
            className={`flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors ${
              inCart ? "border border-emerald-400/30 bg-emerald-400/10 text-emerald-300" : "bg-[var(--accent)] text-white hover:brightness-110"
            }`}
          >
            {inCart ? <Check className="h-4 w-4" /> : <ShoppingCart className="h-4 w-4" />}
            {inCart ? t("cart.added") : t("cart.add")}
          </button>
        </div>
      </div>
    </div>
  );
}
