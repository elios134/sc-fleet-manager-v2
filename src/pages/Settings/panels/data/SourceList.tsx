import { useTranslation } from "react-i18next";
import { Boxes, Database, Tags } from "lucide-react";
import { SourceRow } from "../../components/SourceRow";
import { freshnessOf } from "../../status";
import { useAutoSyncState } from "../../../../hooks/useAutoSync";
import type { DataSync } from "../../hooks/useDataSync";

/** Une ligne par source synchronisable. */
export function SourceList({ sync }: { sync: DataSync }) {
  const { t } = useTranslation();
  const { enabled: auto } = useAutoSyncState();
  const rows = [
    { key: "wiki" as const, icon: Database, color: "var(--accent)", name: t("settings.donnees.sourceWikiName"), desc: t("settings.donnees.sourceWikiDesc"), state: sync.wikiGroup },
    { key: "cargo" as const, icon: Boxes, color: "#5dcaa5", name: t("settings.donnees.sourceCargoName"), desc: t("settings.donnees.sourceCargoDesc"), state: sync.cargoGroup },
    { key: "uex" as const, icon: Tags, color: "var(--amber)", name: t("settings.donnees.sourceUexName"), desc: t("settings.donnees.sourceUexDesc"), state: sync.uexGroup },
  ];
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
          autoLabel={auto ? t(r.key === "uex" ? "autoSync.pillLaunch" : "autoSync.pillPatch") : undefined}
        />
      ))}
    </div>
  );
}
