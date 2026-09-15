import { Search, LayoutGrid, List } from "lucide-react";
import type { TFunction } from "i18next";
import type { FleetFilter, ShipView, SortKey } from "../types";

interface Props {
  search: string;
  setSearch: (v: string) => void;
  chips: ReadonlyArray<readonly [string, FleetFilter]>;
  filter: FleetFilter;
  setFilter: (v: FleetFilter) => void;
  sortKey: SortKey;
  setSortKey: (v: SortKey) => void;
  view: ShipView;
  setView: (v: ShipView) => void;
  t: TFunction;
}

/* Barre d'outils de la flotte : recherche + chips catégories (Tous / LTI / catégories RSI
   présentes) + tri (valeur/nom/assurance) + bascule grille/liste. */
export default function FleetToolbar(p: Props) {
  const sorts: ReadonlyArray<readonly [SortKey, string]> = [
    ["value", "fleet.sortValue"],
    ["name", "fleet.sortName"],
    ["ins", "fleet.sortInsurance"],
  ];
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2.5">
      <div className="relative min-w-[200px] max-w-[260px] flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
        <input
          type="text"
          value={p.search}
          onChange={(e) => p.setSearch(e.target.value)}
          placeholder={p.t("fleet.searchPlaceholder2")}
          className="h-9 w-full rounded-lg border border-white/10 bg-white/5 pl-9 pr-3 text-[13px] text-white placeholder:text-white/40 focus:border-accent/40 focus:outline-none"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        {p.chips.map(([label, value]) => (
          <button
            key={value}
            onClick={() => p.setFilter(value)}
            className={[
              "rounded-full border px-3.5 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors",
              p.filter === value
                ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-foreground)]"
                : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10",
            ].join(" ")}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="ml-auto flex items-center gap-2">
        <div className="flex rounded-lg border border-white/10 bg-white/5 p-0.5 text-xs">
          {sorts.map(([k, key]) => (
            <button
              key={k}
              onClick={() => p.setSortKey(k)}
              className={[
                "rounded-md px-2.5 py-1 transition-colors",
                p.sortKey === k ? "bg-[var(--accent)] text-[var(--accent-foreground)]" : "text-white/55 hover:text-white",
              ].join(" ")}
            >
              {p.t(key)}
            </button>
          ))}
        </div>
        <div className="flex rounded-lg border border-white/10 bg-white/5 p-0.5">
          <button
            aria-label={p.t("fleet.viewGrid")}
            onClick={() => p.setView("grid")}
            className={["rounded-md p-1.5 transition-colors", p.view === "grid" ? "bg-[var(--accent)] text-[var(--accent-foreground)]" : "text-white/55 hover:text-white"].join(" ")}
          >
            <LayoutGrid size={15} />
          </button>
          <button
            aria-label={p.t("fleet.viewList")}
            onClick={() => p.setView("list")}
            className={["rounded-md p-1.5 transition-colors", p.view === "list" ? "bg-[var(--accent)] text-[var(--accent-foreground)]" : "text-white/55 hover:text-white"].join(" ")}
          >
            <List size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
