import { Search, Footprints } from "lucide-react";
import type { TFunction } from "i18next";
import Dropdown from "../../../components/ui/Dropdown";
import ShipCard from "./ShipCard";
import type { ShipRow } from "../types";

interface Props {
  search: string;
  setSearch: (v: string) => void;
  manuFilter: string;
  setManuFilter: (v: string) => void;
  manufacturers: string[];
  visitableOnly: boolean;
  setVisitableOnly: (fn: (v: boolean) => boolean) => void;
  visitableCount: number;
  totalCount: number;
  filtered: ShipRow[];
  selName: string | null;
  onSelect: (name: string) => void;
  hasModel: (s: ShipRow) => boolean;
  isVisitable: (s: ShipRow) => boolean;
  t: TFunction;
}

/* Dock bas : barre de filtres compacte + bande horizontale de vaisseaux (remplace l'ancienne
   liste latérale 340px). Verre dépoli superposé au viewer. */
export default function ShipDock(p: Props) {
  return (
    <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/75 via-black/55 to-transparent px-4 pb-3.5 pt-8 backdrop-blur-sm">
      <div className="mb-2.5 flex items-center gap-2.5">
        <div className="relative max-w-[280px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
          <input
            value={p.search}
            onChange={(e) => p.setSearch(e.target.value)}
            placeholder={p.t("ship3d.searchPlaceholder")}
            className="h-9 w-full rounded-lg border border-white/10 bg-white/5 pl-9 pr-3 text-sm text-white placeholder:text-white/30 focus:border-accent/40 focus:outline-none"
          />
        </div>
        <Dropdown
          value={p.manuFilter}
          onChange={p.setManuFilter}
          ariaLabel={p.t("ship3d.manufacturer")}
          className="w-[200px]"
          options={[
            { value: "all", label: p.t("ship3d.allManufacturers") },
            ...p.manufacturers.map((m) => ({ value: m, label: m })),
          ]}
        />
        <button
          onClick={() => p.setVisitableOnly((v) => !v)}
          aria-pressed={p.visitableOnly}
          className={[
            "flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm transition-colors",
            p.visitableOnly
              ? "border-[var(--accent)]/50 bg-[var(--accent)]/[0.16] text-white"
              : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10",
          ].join(" ")}
        >
          <Footprints className="h-4 w-4" />
          {p.t("ship3d.visitableOnly")}
          <span
            className={[
              "rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums",
              p.visitableOnly ? "bg-white/20 text-white" : "bg-white/10 text-white/70",
            ].join(" ")}
          >
            {p.visitableCount}
          </span>
        </button>
        <span className="ml-auto text-[11px] font-medium uppercase tracking-wider text-white/40">
          {p.t("ship3d.statShips", { n: p.totalCount })}
        </span>
      </div>
      <div className="flex gap-2.5 overflow-x-auto pb-1">
        {p.filtered.length === 0 ? (
          <p className="px-1 py-6 text-sm text-white/40">{p.t("ship3d.noShips")}</p>
        ) : (
          p.filtered.map((s) => (
            <ShipCard
              key={s.id}
              ship={s}
              variant="dock"
              selected={s.name === p.selName}
              real={p.hasModel(s)}
              walkable={p.isVisitable(s)}
              onClick={() => p.onSelect(s.name)}
              t={p.t}
            />
          ))
        )}
      </div>
    </div>
  );
}
