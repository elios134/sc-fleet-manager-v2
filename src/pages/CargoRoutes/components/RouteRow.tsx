import { ArrowRight, Truck, MapPin } from "lucide-react";
import { type TFunction } from "i18next";
import { type CargoRoute } from "../types";
import { fmt, relativeAge, priceFresh } from "../helpers";

function RouteRow({
  r,
  rank,
  t,
  onClick,
  onLoad,
  highlightBest = false,
}: {
  r: CargoRoute;
  rank: number;
  t: TFunction;
  onClick: () => void;
  onLoad: () => void;
  // Surligne le rang 1 comme « meilleure » : pertinent pour une LISTE TRIÉE (Planificateur),
  // pas pour une séquence d'étapes (Boucle) → désactivé par défaut.
  highlightBest?: boolean;
}) {
  const from = r.fromName ?? r.fromLocation;
  const to = r.toName ?? r.toLocation;
  const dash = "—";
  const fresh = priceFresh(r.priceTimestamp);
  const best = highlightBest && rank === 1;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className={`w-full cursor-pointer rounded-xl border px-4 py-3 text-left transition-colors ${
        best
          ? "border-emerald-400/40 bg-emerald-400/[0.07] hover:border-emerald-400/60"
          : "border-white/10 bg-white/[0.03] hover:border-[var(--accent)]/40"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="w-5 shrink-0 text-[11px] text-white/30">#{rank}</span>
        <span className="truncate text-sm font-medium capitalize text-white">{r.commodity}</span>
        {best && (
          <span className="inline-flex shrink-0 items-center rounded-full border border-emerald-400/40 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-emerald-300">
            {t("cargo.bestRoute")}
          </span>
        )}
        {fresh != null && (
          <span
            className="inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px]"
            style={fresh ? { color: "#34d399", background: "rgba(52,211,153,0.14)" } : { color: "#fbbf24", background: "rgba(251,191,36,0.14)" }}
          >
            {relativeAge(r.priceTimestamp, t)}
          </span>
        )}
        <span className="ml-auto shrink-0 text-[15px] font-medium text-emerald-400">
          +{fmt(r.profit)} <span className="text-[11px] font-normal text-white/40">aUEC</span>
        </span>
      </div>

      <div className="mt-1.5 flex items-center gap-1.5 text-[13px] text-white/70">
        <MapPin className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]" />
        <span className="truncate capitalize">{from}</span>
        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-white/30" />
        <span className="truncate capitalize">{to}</span>
        {r.profitPerMinute != null && (
          <span className="ml-auto shrink-0 text-[11px] text-[var(--accent)]">
            {fmt(r.profitPerMinute)} {t("cargo.unit.perMin")}
          </span>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-white/50">
        <span>{t("cargo.results.buy")} <span className="text-white/75">{fmt(r.buyPrice)}</span></span>
        <span>{t("cargo.results.sell")} <span className="text-white/75">{fmt(r.sellPrice)}</span></span>
        <span>{t("cargo.results.margin")} <span className="text-white/75">{fmt(r.marginUnit)}</span></span>
        <span>{t("cargo.results.qty")} <span className="text-white/75">{fmt(r.quantityScu)} SCU</span></span>
        <span>{t("cargo.results.distance")} <span className="text-white/75">{r.distanceGm != null ? `${r.distanceGm.toFixed(2)} Gm` : dash}</span></span>
        <span>{t("cargo.results.time")} <span className="text-white/75">{r.timeMinutes != null ? `${r.timeMinutes.toFixed(1)} ${t("cargo.unit.min")}` : dash}</span></span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onLoad();
          }}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-2.5 py-1 text-[11px] font-medium text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/20"
        >
          <Truck className="h-3.5 w-3.5" />
          {t("cargo.loadToHold")}
        </button>
      </div>
    </div>
  );
}

export { RouteRow };
