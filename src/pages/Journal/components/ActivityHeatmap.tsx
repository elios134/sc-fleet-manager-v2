// Heatmap d'activité (52 semaines) type contribution-graph, dégradé accent séquentiel.

import type { TFunction } from "i18next";
import { buildHeatmap, fmtHours } from "../helpers";

const LEVEL_BG = [
  "rgba(255,255,255,0.05)",
  "color-mix(in oklab, var(--accent) 28%, transparent)",
  "color-mix(in oklab, var(--accent) 48%, transparent)",
  "color-mix(in oklab, var(--accent) 72%, transparent)",
  "var(--accent)",
];

export function ActivityHeatmap({
  data,
  t,
}: {
  data: { date: string; seconds: number }[];
  t: TFunction;
}) {
  const { cells, monthLabels, peak } = buildHeatmap(data);
  const dayLabels = ["", "Lun", "", "Mer", "", "Ven", ""];
  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-[12px] font-semibold uppercase tracking-[0.13em] text-white/50">
          {t("journal.ovActivity")}
        </span>
        {peak && (
          <span className="text-[11px] text-white/35">
            {t("journal.ovPeak", { hours: fmtHours(peak.seconds) })}
          </span>
        )}
      </div>
      <div className="overflow-x-auto pb-1">
        <div className="min-w-[640px]">
          <div className="mb-1.5 ml-[26px] grid grid-flow-col text-[9.5px] uppercase tracking-wider text-white/35">
            {monthLabels.map((m, i) => (
              <span key={i}>{m ?? ""}</span>
            ))}
          </div>
          <div className="flex gap-[3px]">
            <div className="mr-1 grid grid-rows-7 gap-[3px] text-[9px] text-white/35">
              {dayLabels.map((d, i) => (
                <span key={i} className="h-[12px] leading-[12px]">
                  {d}
                </span>
              ))}
            </div>
            <div className="grid grid-flow-col gap-[3px]" style={{ gridTemplateRows: "repeat(7, 12px)" }}>
              {cells.map((col, ci) =>
                col.map((cell) => (
                  <span
                    key={`${ci}-${cell.date}`}
                    className="h-[12px] w-[12px] rounded-[3px]"
                    style={{ background: LEVEL_BG[cell.level] }}
                    title={cell.seconds > 0 ? `${cell.date} · ${fmtHours(cell.seconds)}` : cell.date}
                  />
                )),
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-end gap-1.5 text-[10.5px] text-white/35">
        {t("journal.ovLess")}
        {LEVEL_BG.map((bg, i) => (
          <span key={i} className="h-[11px] w-[11px] rounded-[3px]" style={{ background: bg }} />
        ))}
        {t("journal.ovMore")}
      </div>
    </div>
  );
}
