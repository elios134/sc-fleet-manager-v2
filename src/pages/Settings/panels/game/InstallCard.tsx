import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { useDatamining } from "../../../../contexts/DataminingContext";
import { Badge } from "../../components/Badge";

type Channel = { label: string; install: { packId: string } | null };

/** Installation Star Citizen : chemin détecté (auto / manuel), canal, fichiers présents,
 *  et pastille « Traduction installée sur X » quand un pack est en place. */
export function InstallCard() {
  const { t } = useTranslation();
  const { install, validation, running, pickFolder, resetPath } = useDatamining();
  const resolved = install?.resolved ?? null;
  const [trad, setTrad] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    invoke<Channel[]>("translation_channels")
      .then((cs) => !cancelled && setTrad(cs.filter((c) => c.install).map((c) => c.label)))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const btn = "rounded-[10px] border border-white/15 bg-white/5 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-white/10 disabled:opacity-50";
  return (
    <section className="glass flex min-w-0 flex-col gap-3 rounded-2xl px-5 py-[18px]">
      <h2 className="flex flex-wrap items-center gap-2.5 text-[15px] font-bold text-white">
        {t("settings.datamining.installLabel")}
        <small className="text-xs font-medium text-white/50">{install?.configured ? t("settings.datamining.channelManual") : t("settings.datamining.channelAuto")}</small>
      </h2>
      <div className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-black/25 px-3 py-2.5">
        {resolved ? (
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-white/80" title={resolved}>{resolved}</span>
        ) : (
          <span className="min-w-0 flex-1 text-sm text-white/50">{t("settings.datamining.noInstall")}</span>
        )}
        <button type="button" onClick={() => void pickFolder()} disabled={running} className={btn}>{t("settings.datamining.pickFolderBtn")}</button>
        {install?.configured && (
          <button type="button" onClick={() => void resetPath()} disabled={running} className={btn}>{t("settings.datamining.resetPathBtn")}</button>
        )}
      </div>
      {resolved && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          {install?.channel && <span className="rounded-full border border-emerald-400/35 bg-emerald-400/15 px-2 font-bold text-emerald-300">{install.channel}</span>}
          <Badge ok={!!validation?.hasDataP4k} label="Data.p4k" />
          <Badge ok={!!validation?.hasGameLog} label="Game.log" />
          {trad.length > 0 && (
            <span className="rounded-full border border-[var(--accent)]/50 bg-[var(--accent-muted)] px-2 font-bold text-white">
              {t("settings.datamining.tradInstalled", { channels: trad.join(", ") })}
            </span>
          )}
        </div>
      )}
    </section>
  );
}
