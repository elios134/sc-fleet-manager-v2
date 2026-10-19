import { useTranslation } from "react-i18next";
import { Boxes, Cpu, Database, Tags } from "lucide-react";
import { SourceRow } from "../../components/SourceRow";
import { freshnessOf } from "../../status";
import { useDatamining } from "../../../../contexts/DataminingContext";
import type { DataSync } from "../../hooks/useDataSync";

/** Une ligne par source synchronisable, puis la ligne « Datamining du jeu » (renvoie vers Jeu). */
export function SourceList({ sync, onOpenGame }: { sync: DataSync; onOpenGame: () => void }) {
  const { t } = useTranslation();
  const { patch } = useDatamining();
  const rows = [
    { key: "wiki" as const, icon: Database, color: "var(--accent)", name: t("settings.donnees.sourceWikiName"), desc: t("settings.donnees.sourceWikiDesc"), state: sync.wikiGroup },
    { key: "cargo" as const, icon: Boxes, color: "#5dcaa5", name: t("settings.donnees.sourceCargoName"), desc: t("settings.donnees.sourceCargoDesc"), state: sync.cargoGroup },
    { key: "uex" as const, icon: Tags, color: "var(--amber)", name: t("settings.donnees.sourceUexName"), desc: t("settings.donnees.sourceUexDesc"), state: sync.uexGroup },
  ];
  const patchLabel =
    patch?.status === "patch_detected" ? t("settings.donnees.dmPatch") : patch?.status === "up_to_date" ? t("settings.donnees.dmOk") : t("settings.donnees.dmUnknown");
  return (
    <div>
      {rows.map((r) => (
        <SourceRow
          key={r.key}
          icon={r.icon}
          iconBg={`color-mix(in oklab, ${r.color} 16%, transparent)`}
          iconColor={r.color}
          name={r.name}
          desc={r.desc}
          state={r.state}
          iso={sync.lastSync[r.key]}
          onSync={() => void sync.runSource(r.key)}
          disabled={sync.anyBusy}
          running={r.state.running}
          accentBtn={freshnessOf(sync.lastSync[r.key]).status === "stale"}
        />
      ))}
      <div className="flex flex-col gap-3 border-t border-white/[0.09] pt-3 sm:flex-row sm:items-center sm:gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-white/70">
          <Cpu className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-white">
            {t("settings.donnees.dmName")}
            <span
              className={`rounded-full border px-2 text-[10.5px] font-bold ${
                patch?.status === "patch_detected" ? "border-[var(--amber)]/40 bg-[var(--amber-muted)] text-amber-200" : "border-white/15 text-white/55"
              }`}
            >
              {patch?.installedVersion ? `${patch.installedChannel ?? "LIVE"} ${patch.installedVersion} · ${patchLabel}` : patchLabel}
            </span>
          </p>
          <p className="mt-0.5 text-[12px] text-white/45">{t("settings.donnees.dmDesc")}</p>
        </div>
        <button type="button" onClick={onOpenGame} className="shrink-0 rounded-[10px] border border-white/15 bg-white/5 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-white/10">
          {t("settings.donnees.dmOpen")}
        </button>
      </div>
    </div>
  );
}
