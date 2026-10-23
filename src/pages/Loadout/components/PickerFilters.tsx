import { Hammer, Package, Search, ShoppingCart } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { OfferSort } from "../lib/shopping";
import { OfferSortBar } from "./OfferSortBar";

export type AcqFilter = "all" | "buy" | "craft" | "stock";

/** Recherche, filtres d'acquisition et tri par offre d'achat du sélecteur de composant. */
export function PickerFilters({
  search,
  setSearch,
  acqFilter,
  setAcqFilter,
  offerSort,
  onOfferSort,
  hasPosition,
}: {
  search: string;
  setSearch: (s: string) => void;
  acqFilter: AcqFilter;
  setAcqFilter: (f: AcqFilter) => void;
  offerSort: OfferSort | null;
  onOfferSort: (s: OfferSort) => void;
  hasPosition: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="shrink-0 px-6 py-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("loadout.pickerSearchPlaceholder")}
          className="w-full rounded-full border border-white/10 bg-white/5 py-2 pl-9 pr-4 text-sm text-white placeholder:text-white/40 focus:border-white/20 focus:outline-none"
        />
      </div>
      {/* Filtres d'acquisition (Lot 5) : tous / achetables / craftables */}
      <div className="mt-2.5 flex items-center gap-2">
        {([
          { key: "all", label: t("loadout.acqAll"), icon: null },
          { key: "buy", label: t("loadout.acqBuy"), icon: ShoppingCart },
          { key: "craft", label: t("loadout.acqCraft"), icon: Hammer },
          { key: "stock", label: t("loadout.acqStock"), icon: Package },
        ] as const).map((chip) => {
          const active = acqFilter === chip.key;
          const Icon = chip.icon;
          return (
            <button
              key={chip.key}
              type="button"
              onClick={() => setAcqFilter(chip.key)}
              className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors"
              style={{
                borderColor: active ? "rgba(96,165,250,0.5)" : "rgba(255,255,255,0.1)",
                background: active ? "rgba(96,165,250,0.15)" : "transparent",
                color: active ? "#93c5fd" : "rgba(255,255,255,0.55)",
              }}
            >
              {Icon && <Icon className="h-3.5 w-3.5" />}
              {chip.label}
            </button>
          );
        })}
        <OfferSortBar
          value={offerSort}
          hasPosition={hasPosition}
          onChange={onOfferSort}
        />
      </div>
    </div>
  );
}
