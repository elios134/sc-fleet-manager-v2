import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { Badge } from "./Badge";

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
    <section className="glass flex min-w-0 flex-col gap-3 rounded-2xl px-5 py-[18px]">
      <h2 className="text-[15px] font-bold text-white">{t("settings.gamelog.label")}</h2>
      <div>
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
    </section>
  );
}

/* ── Overlay en jeu (Phase 2) ── */

export { GameLogCard };
