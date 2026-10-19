import { useTranslation } from "react-i18next";
import { useDataSync } from "../hooks/useDataSync";
import { SettingsCard } from "../components/SettingRow";
import { DataHealth, SyncAllButton } from "./data/DataHealth";
import { SourceList } from "./data/SourceList";
import { AdvancedSync } from "./data/AdvancedSync";

/* Panneau Données : santé des données, une ligne par source, synchronisation avancée. */
export function DataPanel({ onOpenGame }: { onOpenGame: () => void }) {
  const { t } = useTranslation();
  const sync = useDataSync();
  return (
    <SettingsCard title={t("settings.donnees.healthTitle")} hint={t("settings.donnees.healthHint")} action={<SyncAllButton sync={sync} />}>
      <DataHealth sync={sync} />
      <SourceList sync={sync} onOpenGame={onOpenGame} />
      <AdvancedSync sync={sync} />
      {sync.error && <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2 text-sm text-red-300">{sync.error}</p>}
    </SettingsCard>
  );
}
