import { useState } from "react";
import { X, ExternalLink } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import type { HangarItem } from "../types";
import { cosmeticKind, inFleet, shipFor, type Pack } from "../lib/cosmetics";
import { KIND_UI, fmtPackValue } from "../helpers";
import { CosmeticThumb } from "./CosmeticThumb";
import { FleetPill } from "./FleetPill";
import { ItemModal } from "./ItemModal";

const RSI_PLEDGES = "https://robertsspaceindustries.com/en/account/pledges";

/* Fenêtre d'un pack : valeur, date d'achat, et la liste de ses objets (chacun ouvre sa fiche). */
export function PackModal({ pack, fleetNames, onClose }: { pack: Pack; fleetNames: string[] | null; onClose: () => void }) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<HangarItem | null>(null);
  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-6" onClick={onClose}>
        <div className="absolute inset-0 bg-black/60" />
        <div
          onClick={(e) => e.stopPropagation()}
          className="relative z-10 max-h-[88vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-[var(--card-border)] bg-[var(--background)]/95 p-6 backdrop-blur-2xl"
        >
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-white">{pack.name}</h2>
              <p className="text-sm text-white/45">
                {t("items.itemsCount", { n: pack.items.length })} · {fmtPackValue(pack.valueUsd)}
                {pack.createdDate ? ` · ${t("items.packDate")} ${pack.createdDate}` : ""}
              </p>
            </div>
            <button onClick={onClose} className="rounded-lg p-1 text-white/60 hover:bg-white/10" aria-label={t("action.close")}>
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="flex flex-col gap-1">
            {pack.items.map((it) => {
              const kind = KIND_UI[cosmeticKind(it)];
              const ship = shipFor(it);
              return (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => setSelected(it)}
                  className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/5 p-2 text-left transition-colors hover:bg-white/10"
                >
                  <CosmeticThumb imageUrl={it.imageUrl} className="h-10 w-10" glyph={18} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-white">{it.title}</span>
                    <span className="block truncate text-xs text-white/40">{[it.manufacturer, ship].filter(Boolean).join(" · ")}</span>
                  </span>
                  {ship && <FleetPill owned={fleetNames ? inFleet(ship, fleetNames) : null} />}
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--accent)]/40 px-2 py-0.5 text-[10.5px] text-white/80">
                    <kind.Icon className="h-3 w-3" /> {t(kind.labelKey)}
                  </span>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => void openUrl(RSI_PLEDGES).catch(() => {})}
            className="mt-4 inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10"
          >
            <ExternalLink className="h-4 w-4" /> {t("items.openRsi")}
          </button>
        </div>
      </div>
      {selected && <ItemModal item={selected} fleetNames={fleetNames} onClose={() => setSelected(null)} />}
    </>
  );
}
