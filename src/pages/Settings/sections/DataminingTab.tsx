import { useDatamining, phaseLabel } from "../../../contexts/DataminingContext";
import { useTranslation } from "react-i18next";
import { Badge } from "../components/Badge";
import { GameLogCard } from "../components/GameLogCard";

function formatEta(seconds: number | null): string {
  if (seconds === null || seconds < 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/* ── Lecteur Game.log (Phase 1) : opt-in, 100 % local ── */

function DataminingTab() {
  const { t } = useTranslation();
  const {
    status,
    install,
    validation,
    patch,
    log,
    running,
    start,
    cancel,
    pickFolder,
    resetPath,
  } = useDatamining();

  const resolved = install?.resolved ?? null;
  const canStart = !running && !!resolved;
  const pct = Math.round(status.percentOverall);

  return (
    <div className="space-y-5">
      {/* ── Chemin d'install ── */}
      <div>
        <p className="mb-2 text-xs uppercase tracking-wider text-white/40">
          {t("settings.datamining.installLabel")}
        </p>
        <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3">
          {resolved ? (
            <>
              <p className="truncate font-mono text-sm text-white/80" title={resolved}>
                {resolved}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                {install?.channel && (
                  <span className="rounded-full bg-white/10 px-2 py-0.5 font-semibold text-white/60">
                    {install.channel}
                  </span>
                )}
                <Badge ok={!!validation?.hasDataP4k} label="Data.p4k" />
                <Badge ok={!!validation?.hasGameLog} label="Game.log" />
                {install?.configured ? (
                  <span className="text-white/40">{t("settings.datamining.channelManual")}</span>
                ) : (
                  <span className="text-white/40">{t("settings.datamining.channelAuto")}</span>
                )}
              </div>
            </>
          ) : (
            <p className="text-sm text-white/50">{t("settings.datamining.noInstall")}</p>
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            onClick={() => void pickFolder()}
            disabled={running}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white/80 transition-colors hover:bg-white/10 disabled:opacity-50"
          >
            {t("settings.datamining.pickFolderBtn")}
          </button>
          {install?.configured && (
            <button
              onClick={() => void resetPath()}
              disabled={running}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white/60 transition-colors hover:bg-white/10 disabled:opacity-50"
            >
              {t("settings.datamining.resetPathBtn")}
            </button>
          )}
        </div>
      </div>

      {/* ── Lecteur Game.log (Phase 1) ── */}
      <GameLogCard />

      {/* ── Patch ── */}
      {patch?.status === "patch_detected" && (
        <div className="rounded-xl border border-accent/30 bg-accent/10 px-4 py-2 text-sm text-accent">
          {t("settings.datamining.patchDetected", {
            version: patch.installedVersion ? ` (${patch.installedVersion})` : "",
          })}
        </div>
      )}

      {/* ── Lancer / progression ── */}
      <div>
        {!running ? (
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => void start()}
              disabled={!canStart}
              className="rounded-xl px-4 py-2 text-sm font-semibold text-[#0a0a0f] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              style={{ background: "var(--accent)" }}
            >
              {status.state === "error"
                ? t("settings.datamining.relaunchExtraction")
                : t("settings.datamining.startExtraction")}
            </button>
            {status.state === "completed" && (
              <span className="text-sm text-emerald-400">
                {t("settings.datamining.extractionDone")}
              </span>
            )}
            {status.state === "error" && status.errorMessage && (
              <span className="text-sm text-red-300">
                {t("settings.datamining.extractionError", { message: status.errorMessage })}
              </span>
            )}
            {!resolved && (
              <span className="text-sm text-white/40">
                {t("settings.datamining.installRequired")}
              </span>
            )}
          </div>
        ) : (
          <div>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="uppercase tracking-wider text-white/60">
                {phaseLabel(status.phase, t)}
              </span>
              <span className="font-mono text-[var(--accent)]">{pct}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full transition-[width] duration-700"
                style={{ width: `${pct}%`, background: "var(--accent)" }}
              />
            </div>
            <div className="mt-1.5 flex items-center justify-between text-xs text-white/50">
              <span className="truncate">{status.currentMessage}</span>
              <span className="ml-3 shrink-0">
                {t("settings.datamining.etaPrefix", { eta: formatEta(status.etaSeconds) })}
              </span>
            </div>
            <button
              onClick={() => void cancel()}
              disabled={status.state === "cancelling"}
              className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-sm text-red-300 transition-colors hover:bg-red-500/20 disabled:opacity-50"
            >
              {status.state === "cancelling"
                ? t("settings.datamining.cancelling")
                : t("settings.datamining.cancelBtn")}
            </button>
          </div>
        )}
        {status.state === "completed" && status.tempDir && (
          <p className="mt-2 truncate font-mono text-[11px] text-white/30" title={status.tempDir}>
            {t("settings.datamining.folderPrefix", { dir: status.tempDir })}
          </p>
        )}
      </div>

      {/* ── Journal ── */}
      {log.length > 0 && (
        <div>
          <p className="mb-2 text-xs uppercase tracking-wider text-white/40">
            {t("settings.datamining.journalLabel")}
          </p>
          <div className="max-h-40 overflow-auto rounded-xl border border-white/10 bg-black/30 p-3 font-mono text-[11px] leading-relaxed text-white/60">
            {log.map((line, i) => (
              <div key={i} className="truncate" title={line}>
                {line}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export { DataminingTab };
