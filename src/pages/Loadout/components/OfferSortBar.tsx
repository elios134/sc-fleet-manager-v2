import { useTranslation } from "react-i18next";
import type { OfferSort } from "../lib/shopping";

const SORTS: OfferSort[] = ["nearest", "cheapest", "best"];

/** Tri par offre d'achat : plus proche (désactivé sans position connue), moins cher, meilleur. */
export function OfferSortBar({ value, onChange, hasPosition }: { value: OfferSort | null; onChange: (s: OfferSort) => void; hasPosition: boolean }) {
  const { t } = useTranslation();
  return (
    <div role="group" aria-label={t("loadout.offer.sortLabel")} className="ml-auto flex rounded-full border border-white/10 bg-white/5 p-0.5 text-[11px] font-semibold">
      {SORTS.map((s) => (
        <button
          key={s}
          type="button"
          aria-pressed={value === s}
          disabled={s === "nearest" && !hasPosition}
          title={s === "nearest" && !hasPosition ? t("loadout.offer.noPosition") : undefined}
          onClick={() => onChange(s)}
          className={`rounded-full px-2.5 py-1 disabled:opacity-35 ${value === s ? "bg-[var(--accent)] text-white" : "text-white/55 enabled:hover:text-white"}`}
        >
          {t(`loadout.offer.sort.${s}`)}
        </button>
      ))}
    </div>
  );
}
