import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { Plus, Star, X } from "lucide-react";
import { type CcuShip, type WishItem } from "../types";
import { fmtMoney } from "../helpers";
import { ShipPickerModal } from "./ShipPickerModal";

const chip = "rounded-full border px-2 py-px text-[10.5px] font-bold";

/** Liste de souhaits : état du vaisseau dans le catalogue CCU (en vente, warbond, stock limité)
 *  et alertes à chaque mise à jour du catalogue. Clic sur un vaisseau = cible de la chaîne. */
export function WishlistCard({ ships, onTarget }: { ships: CcuShip[]; onTarget: (shipId: number) => void }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<WishItem[]>([]);
  const [picking, setPicking] = useState(false);
  const reload = useCallback(() => {
    invoke<WishItem[]>("wishlist_list")
      .then(setItems)
      .catch(() => {});
  }, []);
  useEffect(reload, [reload]);
  const toggle = (shipId: number) => {
    void invoke<boolean>("wishlist_toggle", { shipId }).then(reload).catch(() => {});
  };

  return (
    <section className="mt-6 rounded-2xl glass p-4">
      <header className="mb-3 flex items-center gap-2">
        <Star className="h-4 w-4 text-[var(--amber)]" />
        <h2 className="text-sm font-bold text-white">{t("ccu.wishlist.title")}</h2>
        <span className="text-[11px] text-white/40">{t("ccu.wishlist.hint")}</span>
        <button
          type="button"
          onClick={() => setPicking(true)}
          className="ml-auto flex items-center gap-1 rounded-[10px] border border-white/15 bg-white/5 px-2.5 py-1.5 text-[12px] font-semibold text-white hover:bg-white/10"
        >
          <Plus className="h-3.5 w-3.5" /> {t("ccu.wishlist.add")}
        </button>
      </header>
      {items.length === 0 ? (
        <p className="text-[12.5px] text-white/45">{t("ccu.wishlist.empty")}</p>
      ) : (
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {items.map((w) => (
            <li key={w.shipId} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.025] px-3 py-2">
              <button type="button" onClick={() => onTarget(w.shipId)} title={t("ccu.wishlist.target")} className="min-w-0 flex-1 text-left">
                <b className="block truncate text-[13px] text-white">{w.name}</b>
                <span className="mt-0.5 flex flex-wrap gap-1">
                  {w.available ? (
                    <span className={`${chip} border-emerald-400/35 bg-emerald-400/15 text-emerald-300`}>
                      {w.minPriceCents != null ? t("ccu.wishlist.onSale", { price: fmtMoney(w.minPriceCents) }) : t("ccu.wishlist.onSaleNoPrice")}
                    </span>
                  ) : (
                    <span className={`${chip} border-white/15 bg-white/5 text-white/45`}>{t("ccu.wishlist.unavailable")}</span>
                  )}
                  {w.warbond && <span className={`${chip} border-[var(--accent)]/45 bg-[var(--accent-muted)] text-indigo-200`}>{t("ccu.wishlist.warbond")}</span>}
                  {w.limited && (
                    <span className={`${chip} border-[var(--amber)]/40 bg-[var(--amber-muted)] text-amber-300`}>
                      {w.stock != null ? t("ccu.wishlist.limitedStock", { count: w.stock }) : t("ccu.wishlist.limited")}
                    </span>
                  )}
                </span>
              </button>
              <button type="button" onClick={() => toggle(w.shipId)} aria-label={t("ccu.wishlist.remove")} className="rounded p-1 text-white/40 hover:bg-white/10 hover:text-white">
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[11px] text-white/35">{t("ccu.wishlist.note")}</p>
      {picking && (
        <ShipPickerModal
          ships={ships}
          mode="to"
          onPick={(id) => {
            setPicking(false);
            if (!items.some((w) => w.shipId === id)) toggle(id);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </section>
  );
}
