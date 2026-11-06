import { useState } from "react";
import type { TFunction } from "i18next";
import { ChevronDown, Search } from "lucide-react";
import Dropdown from "../../../components/ui/Dropdown";
import type { ListFilter, SortOrder } from "../helpers";

const chip = "flex items-center gap-1 rounded-full border px-3 py-1 text-[11.5px] font-medium transition-colors";

/** Barre de la liste des missions : recherche, factions (choix multiple), tri, compteur et puces
 *  Toutes / Loot / Objectifs / Favoris avec leurs compteurs. */
export function MissionToolbar({
  search,
  setSearch,
  factions,
  selectedFactions,
  setSelectedFactions,
  sortOrder,
  setSortOrder,
  listFilter,
  setListFilter,
  counts,
  t,
}: {
  search: string;
  setSearch: (v: string) => void;
  factions: string[];
  selectedFactions: string[];
  setSelectedFactions: (f: (prev: string[]) => string[]) => void;
  sortOrder: SortOrder;
  setSortOrder: (v: SortOrder) => void;
  listFilter: ListFilter;
  setListFilter: (v: ListFilter) => void;
  counts: { all: number; loot: number; objectives: number; favorites: number; factions: number };
  t: TFunction;
}) {
  const [open, setOpen] = useState(false);
  const chips: Array<[ListFilter, string, number]> = [
    ["all", t("mission.filterAll"), counts.all],
    ["loot", t("mission.filterLoot"), counts.loot],
    ["objectives", t("mission.tabObjectives"), counts.objectives],
    ["favorites", t("mission.tabFavorites"), counts.favorites],
  ];
  return (
    <div className="mb-3 flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <label className="relative min-w-[240px] max-w-md flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("mission.searchPlaceholder")}
            className="w-full rounded-lg border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-sm text-white placeholder:text-white/30 focus:border-[var(--accent)]/60 focus:outline-none"
          />
        </label>
        <div className="relative w-52">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex w-full items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/70 hover:bg-white/10"
          >
            <span className="truncate">
              {selectedFactions.length === 0 ? t("mission.allFactions") : t("mission.factionsCount", { n: selectedFactions.length })}
            </span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0" />
          </button>
          {open && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
              <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-lg border border-white/10 bg-[var(--surface-menu)] p-1 shadow-2xl">
                {selectedFactions.length > 0 && (
                  <button onClick={() => setSelectedFactions(() => [])} className="mb-1 w-full rounded-md px-2 py-1.5 text-left text-[11px] text-accent hover:bg-white/5">
                    {t("mission.deselectAll")}
                  </button>
                )}
                {factions.map((f) => (
                  <label key={f} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs text-white/80 hover:bg-white/5">
                    <input
                      type="checkbox"
                      checked={selectedFactions.includes(f)}
                      onChange={() => setSelectedFactions((prev) => (prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]))}
                      className="accent-[var(--accent)]"
                    />
                    <span className="truncate">{f}</span>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
        <Dropdown
          value={sortOrder}
          onChange={(v) => setSortOrder(v as SortOrder)}
          buttonClassName="text-xs text-white/70"
          className="w-44"
          ariaLabel={t("mission.sortLabel")}
          options={[
            { value: "rep_desc", label: t("mission.sortRepDesc") },
            { value: "duration_asc", label: t("mission.sortDurationAsc") },
            { value: "alpha", label: t("mission.sortAlpha") },
          ]}
        />
        <span className="ml-auto text-[12px] tabular-nums text-white/40">{t("mission.countLine", { n: counts.all, f: counts.factions })}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {chips.map(([key, label, n]) => (
          <button
            key={key}
            type="button"
            onClick={() => setListFilter(key)}
            className={`${chip} ${listFilter === key ? "border-[var(--accent)]/50 bg-[var(--accent-muted)] text-white" : "border-white/10 bg-white/5 text-white/55 hover:bg-white/10"}`}
          >
            {label}
            {n > 0 && <span className="tabular-nums opacity-50">{n}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
