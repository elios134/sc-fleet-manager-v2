import { ChevronRight, Check, X } from "lucide-react";
import { type TFunction } from "i18next";
import { type ActiveConvoy } from "../types";
import { fmt } from "../helpers";

function ConvoyStrip({ convoy, onAdvance, onClose, t }: { convoy: ActiveConvoy; onAdvance: () => void; onClose: () => void; t: TFunction }) {
  const r = convoy.route;
  const from = r.fromName ?? r.fromLocation;
  const to = r.toName ?? r.toLocation;
  const legs = [
    { t: t("cargo.convoy.loaded"), s: from },
    { t: t("cargo.convoy.transit"), s: `${r.commodity} → ${to}` },
    { t: t("cargo.convoy.sell"), s: to },
  ];
  const fillPct = convoy.cargoScu > 0 ? Math.min(100, Math.round((r.quantityScu / convoy.cargoScu) * 100)) : 100;
  const isLast = convoy.leg >= legs.length - 1;
  return (
    <div className="mt-4 grid grid-cols-1 items-center gap-4 rounded-2xl border border-emerald-400/25 bg-gradient-to-b from-emerald-400/[0.07] to-black/20 px-4 py-3 lg:grid-cols-[auto_1fr_auto_auto]">
      <span className="flex items-center gap-2 whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-300">
        <span className="h-2 w-2 rounded-full bg-emerald-400" style={{ boxShadow: "0 0 8px #2ee9a5" }} />
        {t("cargo.convoy.active")}
      </span>
      <div className="flex min-w-0 items-center">
        {legs.map((lg, i) => {
          const done = i < convoy.leg;
          const now = i === convoy.leg;
          return (
            <div key={i} className="flex min-w-0 flex-1 items-center">
              <span
                className={`grid h-6 w-6 flex-none place-items-center rounded-full border text-[11px] font-bold tabular-nums ${
                  done
                    ? "border-emerald-400/50 bg-emerald-400/20 text-emerald-300"
                    : now
                      ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                      : "border-white/15 text-white/40"
                }`}
                style={now ? { boxShadow: "0 0 14px -2px var(--accent)" } : undefined}
              >
                {done ? <Check className="h-3 w-3" /> : i + 1}
              </span>
              <span className="ml-2 min-w-0">
                <span className="block truncate text-[11.5px] font-semibold text-white">{lg.t}</span>
                <span className="block truncate text-[10px] text-white/45">{lg.s}</span>
              </span>
              {i < legs.length - 1 && <span className={`mx-3 h-0.5 flex-1 rounded ${done ? "bg-emerald-400/45" : "bg-white/10"}`} />}
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-2.5 whitespace-nowrap text-[11px] tabular-nums text-white/55">
        <span className="h-2 w-24 overflow-hidden rounded-full bg-white/10">
          <span className="block h-full rounded-full bg-gradient-to-r from-[var(--accent)] to-[var(--accent2,#8b5cf6)]" style={{ width: `${fillPct}%` }} />
        </span>
        <span className="text-white/75">{fmt(r.quantityScu)}/{fmt(convoy.cargoScu)} SCU</span>
      </div>
      <div className="flex items-center gap-2">
        {isLast ? (
          <button type="button" onClick={onClose} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-400 px-4 py-2 text-[13px] font-bold text-[#04231a]">
            <Check className="h-4 w-4" /> {t("cargo.convoy.finish")}
          </button>
        ) : (
          <button type="button" onClick={onAdvance} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-400 px-4 py-2 text-[13px] font-bold text-[#04231a]">
            {t("cargo.convoy.next")} <ChevronRight className="h-4 w-4" />
          </button>
        )}
        <button type="button" onClick={onClose} aria-label={t("cargo.convoy.abort")} className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 text-white/40 hover:text-white/80">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// ── Carte de route (cockpit) : commodité + chemin + aide décision + profit/min + Démarrer ──

export { ConvoyStrip };
