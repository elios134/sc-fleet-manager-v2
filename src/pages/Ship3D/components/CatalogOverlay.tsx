import { X, Box, Footprints } from "lucide-react";
import type { TFunction } from "i18next";
import ShipCard from "./ShipCard";
import type { ShipRow } from "../types";

interface Props {
  open: boolean;
  onClose: () => void;
  filtered: ShipRow[];
  stats: { total: number; with3d: number; visitable: number };
  selName: string | null;
  onSelect: (name: string) => void;
  hasModel: (s: ShipRow) => boolean;
  isVisitable: (s: ShipRow) => boolean;
  t: TFunction;
}

/* Catalogue plein écran : grille de tous les vaisseaux + en-tête avec compteurs
   (total · avec vue 3D · visitables). Ouvert depuis le bouton Catalogue du viewer. */
export default function CatalogOverlay(p: Props) {
  if (!p.open) return null;
  return (
    <div className="absolute inset-0 z-30 flex flex-col rounded-2xl bg-[#05050a]/95 p-5 backdrop-blur-2xl">
      <div className="mb-3.5 flex items-center gap-3">
        <span className="text-xl font-bold uppercase tracking-wider text-white">{p.t("ship3d.catalog")}</span>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full border border-white/10 px-2.5 py-1 text-xs font-medium uppercase tracking-wide tabular-nums text-white/70">
            {p.t("ship3d.statShips", { n: p.stats.total })}
          </span>
          <span className="flex items-center gap-1.5 rounded-full border border-[#2ee9a5]/40 bg-[#2ee9a5]/10 px-2.5 py-1 text-xs font-medium uppercase tracking-wide tabular-nums text-[#2ee9a5]">
            <Box className="h-3.5 w-3.5" />
            {p.t("ship3d.statWith3d", { n: p.stats.with3d })}
          </span>
          <span className="flex items-center gap-1.5 rounded-full border border-[var(--accent)]/40 bg-[var(--accent)]/15 px-2.5 py-1 text-xs font-medium uppercase tracking-wide tabular-nums text-white">
            <Footprints className="h-3.5 w-3.5 text-[var(--accent)]" />
            {p.t("ship3d.statVisitable", { n: p.stats.visitable })}
          </span>
        </div>
        <button
          onClick={p.onClose}
          title={p.t("ship3d.catalogClose")}
          className="ml-auto grid h-9 w-9 place-items-center rounded-lg border border-white/10 bg-white/5 text-white/60 transition-colors hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="grid flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3 overflow-y-auto pr-1">
        {p.filtered.map((s) => (
          <ShipCard
            key={s.id}
            ship={s}
            variant="grid"
            selected={s.name === p.selName}
            real={p.hasModel(s)}
            walkable={p.isVisitable(s)}
            onClick={() => {
              p.onSelect(s.name);
              p.onClose();
            }}
            t={p.t}
          />
        ))}
      </div>
    </div>
  );
}
