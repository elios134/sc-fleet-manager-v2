import { useTranslation } from "react-i18next";
import Dropdown from "../../../components/ui/Dropdown";

type Filters = { onlyAvailable: boolean; maxSteps: number };
const STEP_OPTIONS = Array.from({ length: 15 }, (_, i) => String(i + 1)).map((n) => ({ value: n, label: n }));

/** Réglages de la recherche : CCU en vente seulement, nombre d'étapes max, TVA d'affichage. */
export function ChainFilters({
  filters,
  setFilters,
  vatRate,
  onVatRate,
}: {
  filters: Filters;
  setFilters: (f: (prev: Filters) => Filters) => void;
  vatRate: number;
  onVatRate: (v: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <section className="mt-3 flex flex-wrap items-center gap-5">
      <label className="flex items-center gap-2 text-sm text-white/70">
        <input
          type="checkbox"
          checked={filters.onlyAvailable}
          onChange={(e) => setFilters((f) => ({ ...f, onlyAvailable: e.target.checked }))}
          className="h-4 w-4 accent-[var(--accent)]"
        />
        {t("ccu.availableOnly")}
      </label>
      <label className="flex items-center gap-2 text-sm text-white/70">
        {t("ccu.steps")}
        <Dropdown
          value={String(filters.maxSteps)}
          onChange={(v) => setFilters((f) => ({ ...f, maxSteps: Number(v) }))}
          className="w-16"
          ariaLabel={t("ccu.steps")}
          options={STEP_OPTIONS}
        />
      </label>
      <label className="flex items-center gap-2 text-sm text-white/70" title={t("ccu.vatHint")}>
        {t("ccu.vat")}
        <input
          type="number"
          min={0}
          max={100}
          step={1}
          value={vatRate}
          onChange={(e) => onVatRate(Number(e.target.value))}
          className="w-16 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-sm text-white"
          aria-label={t("ccu.vat")}
        />
        <span className="text-white/40">%</span>
      </label>
    </section>
  );
}
