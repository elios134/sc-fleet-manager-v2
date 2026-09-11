import { useEffect, useState, useCallback, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { PhysicalSize } from "@tauri-apps/api/dpi";
import { emit, listen } from "@tauri-apps/api/event";
import { useDatamining, phaseLabel } from "../../../contexts/DataminingContext";
import { useTranslation } from "react-i18next";

function formatEta(seconds: number | null): string {
  if (seconds === null || seconds < 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/* ── Lecteur Game.log (Phase 1) : opt-in, 100 % local ── */

type GameLogStatusUi = {
  enabled: boolean;
  resolvedPath: string | null;
  pathExists: boolean;
  currentLocation: string | null;
};

function GameLogCard() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<GameLogStatusUi | null>(null);
  const [busy, setBusy] = useState(false);
  const [replayMsg, setReplayMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const s = await invoke<GameLogStatusUi>("get_gamelog_status").catch(() => null);
    setStatus(s);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function toggle() {
    if (!status) return;
    setBusy(true);
    try {
      await invoke("set_gamelog_enabled", { enabled: !status.enabled });
      await refresh();
    } catch {
      /* best-effort */
    } finally {
      setBusy(false);
    }
  }

  async function replay() {
    setBusy(true);
    setReplayMsg(null);
    try {
      const n = await invoke<number>("replay_gamelog");
      setReplayMsg(t("settings.gamelog.replayDone", { count: n }));
      await refresh();
    } catch (e) {
      setReplayMsg(String(e));
    } finally {
      setBusy(false);
    }
  }

  const enabled = status?.enabled ?? false;
  const ready = status?.pathExists ?? false;

  return (
    <div>
      <p className="mb-2 text-xs uppercase tracking-wider text-white/40">
        {t("settings.gamelog.label")}
      </p>
      <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-white/80">{t("settings.gamelog.title")}</p>
            <p className="mt-1 text-xs text-white/50">{t("settings.gamelog.desc")}</p>
          </div>
          <button
            onClick={() => void toggle()}
            disabled={busy || (!enabled && !ready)}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              enabled
                ? "border border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20"
                : "text-[#0a0a0f]"
            }`}
            style={enabled ? undefined : { background: "var(--accent)" }}
          >
            {enabled ? t("settings.gamelog.disable") : t("settings.gamelog.enable")}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
          <Badge ok={ready} label="Game.log" />
          {enabled && (
            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 font-semibold text-emerald-300">
              {t("settings.gamelog.active")}
            </span>
          )}
          {status?.currentLocation && (
            <span className="rounded-full bg-white/10 px-2 py-0.5 font-semibold text-white/60">
              {t("settings.gamelog.locationPrefix", { location: status.currentLocation })}
            </span>
          )}
        </div>

        {!ready && (
          <p className="mt-2 text-xs text-white/40">{t("settings.gamelog.noLog")}</p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            onClick={() => void replay()}
            disabled={busy || !ready}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white/80 transition-colors hover:bg-white/10 disabled:opacity-50"
          >
            {t("settings.gamelog.replay")}
          </button>
          {replayMsg && <span className="text-xs text-white/50">{replayMsg}</span>}
        </div>
      </div>
    </div>
  );
}

/* ── Overlay en jeu (Phase 2) ── */
type OvSettings = {
  opacity: number; clickThrough: boolean; locked: boolean; compact: boolean;
  panels: { route: boolean; timers: boolean };
  routeDetails: { scu: boolean; time: boolean; fuel: boolean; profit: boolean };
  timers: { hangar: boolean; independent: boolean };
  defaultTab: "route" | "timers";
};
const OV_DEFAULTS: OvSettings = {
  opacity: 0.9, clickThrough: false, locked: false, compact: false,
  panels: { route: true, timers: true },
  routeDetails: { scu: true, time: true, fuel: true, profit: true },
  timers: { hangar: true, independent: true },
  defaultTab: "route",
};

function OvSwitch({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex h-5 w-9 flex-none items-center rounded-full p-0.5 transition-colors"
      style={{ background: on ? "var(--accent)" : "rgba(255,255,255,0.15)", justifyContent: on ? "flex-end" : "flex-start" }}
      aria-pressed={on}
    >
      <span className="h-4 w-4 rounded-full bg-white" />
    </button>
  );
}

function OverlayCard() {
  const { t } = useTranslation();
  const [s, setS] = useState<OvSettings>(OV_DEFAULTS);

  useEffect(() => {
    const load = async () => {
      const raw = await invoke<string | null>("get_app_meta", { key: "overlay.settings" }).catch(() => null);
      if (!raw) return;
      try {
        const p = JSON.parse(raw);
        setS({
          ...OV_DEFAULTS, ...p,
          panels: { ...OV_DEFAULTS.panels, ...p.panels },
          routeDetails: { ...OV_DEFAULTS.routeDetails, ...p.routeDetails },
          timers: { ...OV_DEFAULTS.timers, ...p.timers },
        });
      } catch {
        /* défaut */
      }
    };
    void load();
    const un = listen("overlay:settings-changed", () => void load());
    return () => { void un.then((f) => f()); };
  }, []);

  const patch = (p: Partial<OvSettings>) =>
    setS((cur) => {
      const next = { ...cur, ...p };
      void invoke("set_app_meta", { key: "overlay.settings", value: JSON.stringify(next) }).catch(() => {});
      void emit("overlay:settings-changed").catch(() => {});
      return next;
    });

  async function resetGeom() {
    void invoke("set_app_meta", { key: "overlay.geom", value: "" }).catch(() => {});
    try {
      const w = await WebviewWindow.getByLabel("overlay");
      if (w) await w.setSize(new PhysicalSize(360, 480));
    } catch {
      /* overlay fermé */
    }
  }

  const Row = ({ label, hint, ctrl }: { label: string; hint?: string; ctrl: ReactNode }) => (
    <div className="flex items-center gap-3 border-b border-white/5 py-2.5 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="text-sm text-white/80">{label}</div>
        {hint && <div className="text-[11px] text-white/40">{hint}</div>}
      </div>
      {ctrl}
    </div>
  );
  const chip = (on: boolean) =>
    `rounded-lg border px-3 py-1.5 text-xs font-medium ${on ? "border-[var(--accent)]/40 bg-[var(--accent)]/10 text-[var(--accent)]" : "border-white/10 bg-white/5 text-white/50"}`;

  return (
    <div>
      <p className="mb-2 text-xs uppercase tracking-wider text-white/40">{t("settings.overlay.label")}</p>
      <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3">
        <div className="flex items-start justify-between gap-3 border-b border-white/10 pb-3">
          <div className="min-w-0">
            <p className="text-sm text-white/80">{t("settings.overlay.title")}</p>
            <p className="mt-1 text-xs text-white/50">{t("settings.overlay.desc")}</p>
          </div>
          <button
            onClick={() => void invoke("toggle_overlay").catch(() => {})}
            className="shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold text-[#0a0a0f]"
            style={{ background: "var(--accent)" }}
          >
            {t("settings.overlay.toggle")}
          </button>
        </div>

        <Row label={t("settings.overlay.clickThrough")} hint={t("settings.overlay.clickThroughHint")} ctrl={<OvSwitch on={s.clickThrough} onClick={() => patch({ clickThrough: !s.clickThrough })} />} />
        <Row label={t("settings.overlay.lock")} ctrl={<OvSwitch on={s.locked} onClick={() => patch({ locked: !s.locked })} />} />
        <Row label={t("settings.overlay.compact")} hint={t("settings.overlay.compactHint")} ctrl={<OvSwitch on={s.compact} onClick={() => patch({ compact: !s.compact })} />} />
        <Row
          label={t("settings.overlay.opacity")}
          ctrl={
            <div className="flex flex-none items-center gap-2">
              <input
                type="range" min={40} max={100} step={5} value={Math.round(s.opacity * 100)}
                onChange={(e) => patch({ opacity: Number(e.target.value) / 100 })}
                className="w-28"
              />
              <span className="w-9 text-right text-xs text-white/70">{Math.round(s.opacity * 100)}%</span>
            </div>
          }
        />

        <div className="mt-3 border-t border-white/10 pt-3">
          <div className="mb-2 text-xs font-medium text-white/60">{t("settings.overlay.panels")}</div>
          <div className="flex gap-2">
            {(["route", "timers"] as const).map((k) => (
              <button
                key={k}
                onClick={() => patch({ panels: { ...s.panels, [k]: !s.panels[k] } })}
                className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium ${
                  s.panels[k] ? "border-[var(--accent)]/40 bg-[var(--accent)]/10 text-[var(--accent)]" : "border-white/10 bg-white/5 text-white/50"
                }`}
              >
                {k === "route" ? t("settings.overlay.panelRoute") : t("settings.overlay.panelTimers")}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 border-t border-white/10 pt-3">
          <div className="mb-2 text-xs font-medium text-white/60">{t("settings.overlay.routeDetails")}</div>
          <div className="flex flex-wrap gap-2">
            {([["scu", "detailScu"], ["time", "detailTime"], ["fuel", "detailFuel"], ["profit", "detailProfit"]] as const).map(([k, lbl]) => (
              <button key={k} onClick={() => patch({ routeDetails: { ...s.routeDetails, [k]: !s.routeDetails[k] } })} className={chip(s.routeDetails[k])}>
                {t(`settings.overlay.${lbl}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 border-t border-white/10 pt-3">
          <div className="mb-2 text-xs font-medium text-white/60">{t("settings.overlay.timersContent")}</div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => patch({ timers: { ...s.timers, hangar: !s.timers.hangar } })} className={chip(s.timers.hangar)}>
              {t("settings.overlay.timerHangar")}
            </button>
            <button onClick={() => patch({ timers: { ...s.timers, independent: !s.timers.independent } })} className={chip(s.timers.independent)}>
              {t("settings.overlay.timerIndependent")}
            </button>
          </div>
        </div>

        <div className="mt-3 border-t border-white/10 pt-3">
          <div className="mb-2 text-xs font-medium text-white/60">{t("settings.overlay.defaultTab")}</div>
          <div className="flex overflow-hidden rounded-lg border border-white/10">
            {(["route", "timers"] as const).map((k) => (
              <button
                key={k}
                onClick={() => patch({ defaultTab: k })}
                className={`flex-1 px-3 py-1.5 text-xs font-medium ${s.defaultTab === k ? "bg-[var(--accent)] text-black" : "bg-white/5 text-white/60"}`}
              >
                {k === "route" ? t("settings.overlay.panelRoute") : t("settings.overlay.panelTimers")}
              </button>
            ))}
          </div>
        </div>

        <button onClick={() => void resetGeom()} className="mt-3 w-full rounded-lg border border-white/10 bg-white/5 py-2 text-xs text-white/60 hover:bg-white/10">
          {t("settings.overlay.reset")}
        </button>
      </div>
    </div>
  );
}

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

      {/* ── Overlay en jeu (Phase 2) ── */}
      <OverlayCard />

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

function Badge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className="rounded-full px-2 py-0.5 font-semibold"
      style={{
        color: ok ? "#34d399" : "#f87171",
        background: ok ? "rgba(52,211,153,0.12)" : "rgba(248,113,113,0.12)",
      }}
    >
      {ok ? "✓" : "✕"} {label}
    </span>
  );
}

/* ───────────────────────── Onglet À propos ───────────────────────── */

export { DataminingTab };
