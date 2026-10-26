import { useTranslation } from "react-i18next";
import { fmtMoney, shipName } from "../helpers";
import { SortButton } from "./SortButton";
import type { CcuPath, CcuShip } from "../types";

/** Tous les chemins trouvés en liste compacte : clic = chemin affiché dans la frise. */
export function PathList({
  paths,
  totalFound,
  selected,
  onSelect,
  sortMode,
  setSortMode,
  shipsById,
}: {
  paths: Array<{ p: CcuPath; originalIndex: number }>;
  totalFound: number;
  selected: number;
  onSelect: (originalIndex: number) => void;
  sortMode: "cost" | "saving";
  setSortMode: (m: "cost" | "saving") => void;
  shipsById: Map<number, CcuShip>;
}) {
  const { t } = useTranslation();
  return (
    <section className="mt-4">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-bold text-white">
          {t("ccu.allPaths")} <span className="font-normal text-white/40">({totalFound})</span>
        </h2>
        <div className="flex gap-1">
          <SortButton active={sortMode === "cost"} onClick={() => setSortMode("cost")}>{t("ccu.sortCostBtn")}</SortButton>
          <SortButton active={sortMode === "saving"} onClick={() => setSortMode("saving")}>{t("ccu.sortSavingBtn")}</SortButton>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {paths.map(({ p, originalIndex }) => {
          const on = originalIndex === selected;
          const ids = [p.steps[0]?.fromShipId, ...p.steps.map((s) => s.toShipId)].filter((id): id is number => id != null);
          const saving = p.savingCents != null && p.savingCents > 0 ? p.savingCents : null;
          return (
            <button
              key={originalIndex}
              type="button"
              onClick={() => onSelect(originalIndex)}
              aria-pressed={on}
              className={`flex items-center justify-between gap-3 rounded-2xl border px-3.5 py-3 text-left transition-colors ${on ? "border-[var(--accent)]/55 bg-[var(--accent-muted)]" : "border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.05]"}`}
            >
              <span className="min-w-0 text-[13px] text-white/80">
                {originalIndex === 0 && <span className="mr-2 rounded-full border border-[var(--accent)]/50 px-2 py-px text-[10px] font-semibold text-white">{t("ccu.best")}</span>}
                {ids.map((id) => shipName(shipsById, id)).join(" → ")}
              </span>
              <span className="shrink-0 text-[13px] tabular-nums">
                <b className="text-white">{fmtMoney(p.totalCostCents)}</b>
                {saving != null && <span className="ml-2 font-bold text-emerald-300">−{fmtMoney(saving)}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
