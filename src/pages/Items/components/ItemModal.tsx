import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { HangarItem } from "../types";
import { cosmeticKind, inFleet, shipFor } from "../lib/cosmetics";
import { KIND_UI } from "../helpers";
import { CosmeticThumb } from "./CosmeticThumb";
import { FleetPill } from "./FleetPill";

/* Fenêtre d'un objet : grande image, type, fabricant, pack d'origine, vaisseau concerné. */
export function ItemModal({ item, fleetNames, onClose }: { item: HangarItem; fleetNames: string[] | null; onClose: () => void }) {
  const { t } = useTranslation();
  const kind = KIND_UI[cosmeticKind(item)];
  const ship = shipFor(item);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-6" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative z-10 max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-[var(--card-border)] bg-[var(--background)]/95 backdrop-blur-2xl"
      >
        <button onClick={onClose} className="absolute right-3 top-3 z-10 rounded-lg p-1 text-white/60 hover:bg-white/10" aria-label={t("action.close")}>
          <X className="h-5 w-5" />
        </button>
        <CosmeticThumb imageUrl={item.imageUrl} className="h-[26rem] w-full rounded-none border-0" glyph={80} />
        <div className="p-5">
          <span className="inline-flex items-center gap-1 rounded-full border border-[var(--accent)]/50 bg-[var(--accent-muted)] px-2 py-0.5 text-[11px] text-white">
            <kind.Icon className="h-3 w-3" /> {t(kind.labelKey)}
          </span>
          <h2 className="mt-2 text-lg font-bold text-white">{item.title}</h2>
          {item.manufacturer && <p className="text-sm text-white/50">{item.manufacturer}</p>}
          <div className="mt-4 border-t border-white/10 pt-3">
            <p className="text-xs uppercase tracking-wider text-white/40">{t("items.packOrigin")}</p>
            <p className="text-sm text-white/70">{item.pledgeName ?? "—"}</p>
          </div>
          {ship && (
            <div className="mt-3 flex items-center justify-between gap-3 border-t border-white/10 pt-3">
              <span>
                <span className="block text-xs uppercase tracking-wider text-white/40">{t("items.forShip")}</span>
                <span className="text-sm text-white/80">{ship}</span>
              </span>
              <FleetPill owned={fleetNames ? inFleet(ship, fleetNames) : null} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
