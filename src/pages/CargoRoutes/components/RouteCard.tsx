import { ArrowRight, Play } from "lucide-react";
import { type TFunction } from "i18next";
import { type CargoRoute } from "../types";
import { fmt, relativeAge, priceFresh } from "../helpers";

function RouteCard({ r, rank, selected, highlightBest, t, onSelect, onStart }: {
  r: CargoRoute; rank: number; selected: boolean; highlightBest: boolean; t: TFunction; onSelect: () => void; onStart: () => void;
}) {
  const from = r.fromName ?? r.fromLocation;
  const to = r.toName ?? r.toLocation;
  const best = highlightBest && rank === 1;
  const fresh = priceFresh(r.priceTimestamp);
  return (
    <article
      onClick={onSelect}
      className={`grid cursor-pointer grid-cols-[1fr_auto] gap-x-4 gap-y-3 rounded-2xl border p-4 transition-colors ${
        selected
          ? "border-[var(--accent)] bg-[var(--accent)]/[0.06]"
          : best
            ? "border-emerald-400/40 bg-gradient-to-r from-emerald-400/[0.07] to-transparent hover:border-emerald-400/60"
            : "border-white/10 bg-white/[0.03] hover:border-white/25"
      }`}
      style={selected ? { boxShadow: "0 0 0 1px var(--accent)" } : undefined}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2.5">
          <span className="truncate text-[17px] font-bold capitalize text-white">{r.commodity}</span>
          {best && (
            <span className="rounded-md bg-emerald-400 px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-wider text-[#04231a]">
              {t("cargo.bestRoute")}
            </span>
          )}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12.5px] text-white/60">
          <span className="font-medium capitalize text-white/85">{from}</span>
          <ArrowRight className="h-3.5 w-3.5 text-[var(--accent2,#8b5cf6)]" />
          <span className="font-medium capitalize text-white/85">{to}</span>
          {r.jumps != null && <span className="text-white/35">· {t("cargo.jumpsN", { n: r.jumps })}</span>}
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-white/[0.05] px-2 py-1 text-[11px] tabular-nums text-white/60">
            <span className="h-1.5 w-12 overflow-hidden rounded-full bg-white/10">
              <span className="block h-full bg-gradient-to-r from-[var(--accent)] to-[var(--accent2,#8b5cf6)]" style={{ width: `${r.quantityScu}%` }} />
            </span>
            {fmt(r.quantityScu)} SCU
          </span>
          {r.timeMinutes != null && (
            <span className="rounded-md bg-white/[0.05] px-2 py-1 text-[11px] tabular-nums text-white/60">~{r.timeMinutes.toFixed(0)} {t("cargo.unit.min")}</span>
          )}
          {fresh != null && (
            <span className={`rounded-md px-2 py-1 text-[11px] tabular-nums ${fresh ? "bg-emerald-400/10 text-emerald-300" : "bg-amber-400/10 text-amber-300"}`}>
              {t("cargo.priceAge", { age: relativeAge(r.priceTimestamp, t) })}
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-col items-end justify-between gap-2">
        <div className="text-right">
          <div className="text-[21px] font-semibold leading-none tabular-nums text-emerald-400">+{fmt(r.profit)}</div>
          {r.profitPerMinute != null && (
            <div className="mt-1 text-[11px] tabular-nums text-white/40">{fmt(r.profitPerMinute)} {t("cargo.unit.perMin")}</div>
          )}
        </div>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onStart(); }}
          className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 py-1.5 text-[12px] font-bold transition-colors ${
            best
              ? "border-emerald-400/50 bg-emerald-400/[0.16] text-emerald-200 hover:bg-emerald-400/25"
              : "border-[var(--accent)]/50 bg-[var(--accent)]/[0.16] text-[#d5d6ff] hover:bg-[var(--accent)]/25"
          }`}
        >
          {t("cargo.convoy.start")} <Play className="h-3 w-3" />
        </button>
      </div>
    </article>
  );
}

// ── Mini-carte du trajet (SVG décoratif, DA app) ──

export { RouteCard };
