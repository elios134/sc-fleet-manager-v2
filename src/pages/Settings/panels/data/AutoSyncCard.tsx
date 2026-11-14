import { useTranslation } from "react-i18next";
import { Toggle } from "../../components/Toggle";
import { useGame } from "../../../../contexts/GameContext";
import { setAutoSyncEnabled, useAutoSyncState } from "../../../../hooks/useAutoSync";

/** Interrupteur « Synchronisation automatique » + règles, patch installé, dernière synchro de patch. */
export function AutoSyncCard() {
  const { t, i18n } = useTranslation();
  const { enabled, last } = useAutoSyncState();
  const { patch } = useGame();
  const installed = patch?.installedVersion
    ? t("autoSync.installedValue", { version: patch.installedVersion, changenum: patch.installedChangenum ?? "—" })
    : t("autoSync.installedNone");
  const lastText = last
    ? t("autoSync.lastValue", { version: last.version ?? "—", date: new Date(last.at).toLocaleDateString(i18n.language, { day: "2-digit", month: "2-digit" }) })
    : t("autoSync.lastNone");
  const tiles = [
    [t("autoSync.ruleUex"), t("autoSync.ruleUexValue")],
    [t("autoSync.rulePatch"), t("autoSync.rulePatchValue")],
    [t("autoSync.installed"), installed],
    [t("autoSync.last"), lastText],
  ];
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-3">
      <div className="flex items-center gap-3.5">
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-semibold text-white">{t("autoSync.title")}</p>
          <p className="mt-0.5 text-xs text-white/50">{t("autoSync.desc")}</p>
        </div>
        <Toggle checked={enabled} onChange={() => void setAutoSyncEnabled(!enabled)} label={t("autoSync.title")} />
      </div>
      <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map(([k, v]) => (
          <div key={k} className="rounded-[10px] border border-white/[0.09] bg-white/[0.03] px-2.5 py-2 text-[12.5px] text-white/50">
            <b className="mb-0.5 block text-[13px] font-semibold text-white">{k}</b>
            {v}
          </div>
        ))}
      </div>
    </div>
  );
}
