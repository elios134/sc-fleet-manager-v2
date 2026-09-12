import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { type FindPathsResult } from "../types";
import { fmtMoney, fmtPct } from "../helpers";

/* ── Ligne de stats (4 colonnes, calquée V1 StatsRow) ── */

function StatsRow({ result }: { result: FindPathsResult }) {
  const { t } = useTranslation();
  const minCost = result.paths.length > 0 ? result.paths[0]!.totalCostCents : null;
  const saving = result.bestSavingCents;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Stat label={t('ccu.statPathsFound')}>
        <span className="text-[var(--accent)]">{result.totalFound}</span>
        <span className="ml-1 text-xs font-normal text-white/40">{t('ccu.routes')}</span>
      </Stat>
      <Stat label={t('ccu.statMinCost')}>
        {minCost != null ? (
          <span className="text-[var(--accent)]">{fmtMoney(minCost)}</span>
        ) : (
          <span className="text-white/30">—</span>
        )}
      </Stat>
      <Stat label={t('ccu.statDirectBuy')}>
        {result.directCostCents != null ? (
          fmtMoney(result.directCostCents)
        ) : (
          <span className="text-white/30">—</span>
        )}
      </Stat>
      <Stat label={t('ccu.statMaxSaving')}>
        {saving != null && saving > 0 ? (
          <span className="text-emerald-400">
            {fmtMoney(saving)}
            <span className="ml-1 text-xs font-normal text-white/40">
              {fmtPct(-saving, result.directCostCents)}
            </span>
          </span>
        ) : (
          <span className="text-white/30">—</span>
        )}
      </Stat>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
      <p className="text-[10px] uppercase tracking-wider text-white/40">{label}</p>
      <p className="mt-1 text-lg font-semibold text-white">{children}</p>
    </div>
  );
}

export { StatsRow, Stat };
