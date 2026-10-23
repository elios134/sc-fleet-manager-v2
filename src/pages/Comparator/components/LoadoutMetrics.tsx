import { useTranslation } from "react-i18next";
import { appLocale } from "../../../lib/format";
import { delta, METRICS, type LoadoutStats } from "../lib/loadouts";
import { COL_BAR } from "./loadoutColors";

/** Barres par stat, avec l'écart en % de chaque colonne par rapport à la référence
 *  (vert = mieux selon le sens de la stat). */
export function LoadoutMetrics({ stats }: { stats: (LoadoutStats | null)[] }) {
  const { t } = useTranslation();
  return (
    <section className="glass rounded-2xl px-4 py-3.5" aria-label={t("comparator.lo.performance")}>
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <h3 className="flex-1 text-[11px] font-bold uppercase tracking-[0.1em] text-white/55">{t("comparator.lo.performance")}</h3>
        <span className="text-[11px] text-white/35">{t("comparator.lo.deltaHint")}</span>
      </div>
      <div className="flex flex-col gap-3">
        {METRICS.map((m) => {
          const vals = stats.map((s) => s?.[m.key] ?? null);
          const max = Math.max(1, ...vals.map((v) => Math.abs(v ?? 0)));
          return (
            <div key={m.key} className="grid grid-cols-1 gap-1.5 sm:grid-cols-[180px_minmax(0,1fr)] sm:items-center">
              <span className="text-[12.5px] text-white/65">
                {t(m.labelKey)} <small className="text-white/35">{m.higherIsBetter ? t("comparator.lo.higher") : t("comparator.lo.lower")}</small>
              </span>
              <div className="flex flex-col gap-1">
                {vals.map((v, i) => {
                  const d = i === 0 ? null : delta(vals[0], v, m.higherIsBetter);
                  return (
                    <div key={i} className="grid grid-cols-[minmax(0,1fr)_130px] items-center gap-2">
                      <div className="h-2 overflow-hidden rounded-full bg-white/[0.07]">
                        <div className={`h-full rounded-full ${COL_BAR[i]}`} style={{ width: `${v == null ? 0 : (Math.abs(v) / max) * 100}%` }} />
                      </div>
                      <span className="text-right font-mono text-[11.5px] text-white/75">
                        {v == null ? "—" : `${v.toLocaleString(appLocale(), { maximumFractionDigits: m.digits })}${m.unit}`}
                        {d?.pct != null && (
                          <span className={`ml-1.5 ${d.good == null ? "text-white/40" : d.good ? "text-emerald-300" : "text-red-300"}`}>
                            {d.pct > 0 ? "+" : ""}
                            {d.pct.toLocaleString(appLocale(), { maximumFractionDigits: 0 })} %
                          </span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
