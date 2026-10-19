import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import { STALE_AFTER_MS } from "../../syncTypes";
import { dataFreshnessSummary } from "../../status";
import type { DataSync } from "../../hooks/useDataSync";

/** Santé des données : compteurs à jour / à rafraîchir / jamais + « Tout synchroniser ». */
export function DataHealth({ sync }: { sync: DataSync }) {
  const { t } = useTranslation();
  const s = dataFreshnessSummary(sync.lastSync, new Date(), STALE_AFTER_MS);
  const tiles = [
    { n: s.ok, label: t("settings.donnees.healthOk"), tone: "text-emerald-300" },
    { n: s.stale, label: t("settings.donnees.healthStale"), tone: "text-amber-300" },
    { n: s.never, label: t("settings.donnees.healthNever"), tone: "text-white/50" },
  ];
  return (
    <>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        {tiles.map((x) => (
          <div key={x.label} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
            <b className={`block text-[22px] font-extrabold tabular-nums ${x.tone}`}>{x.n}</b>
            <span className="text-[11.5px] text-white/50">{x.label}</span>
          </div>
        ))}
      </div>
      <p className="text-xs text-white/40">{t("settings.donnees.introDuration")}</p>
      {sync.allResult &&
        (sync.allResult.failedKeys.length === 0 ? (
          <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2 text-xs text-emerald-300">{t("settings.donnees.syncAllDone")}</p>
        ) : (
          <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2 text-xs text-amber-200">
            {t("settings.donnees.syncAllPartial", { count: sync.allResult.failedKeys.length, list: sync.allResult.failedKeys.map((k) => t(k)).join(", ") })}
          </p>
        ))}
    </>
  );
}

/** Bouton « Tout synchroniser » (action de la carte). */
export function SyncAllButton({ sync }: { sync: DataSync }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={() => void sync.runAllGroups()}
      disabled={sync.anyBusy}
      title={t("settings.donnees.syncAllHint")}
      className="inline-flex items-center gap-2 rounded-[10px] bg-[var(--accent)] px-3 py-1.5 text-[12.5px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
    >
      {sync.allRunning ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : <RefreshCw className="h-3.5 w-3.5" />}
      {sync.allRunning ? t("settings.donnees.syncAllRunning") : t("settings.donnees.syncAllBtn")}
    </button>
  );
}
