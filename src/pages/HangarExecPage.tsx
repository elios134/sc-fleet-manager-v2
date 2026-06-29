import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import { Loader2, RefreshCw, Timer, Play, Warehouse } from "lucide-react";
import {
  formatCountdown,
  pyamProgressPercent,
  pyamSegmentStates,
  groupByLocation,
  type HangarExecStatusResponse,
  type HangarExecTimersResponse,
  type HangarExecStatus,
  type HangarTerminalPreset,
} from "../lib/hangarExec";

function StatusHero({ status, nowMs }: { status: HangarExecStatus; nowMs: number }) {
  const { t } = useTranslation();
  const isOnline = status.status === "ONLINE";
  const secondsRemaining = Math.max(0, Math.floor((status.nextChangeMs - nowMs) / 1000));
  const progress = pyamProgressPercent(isOnline, secondsRemaining);
  const segments = pyamSegmentStates(isOnline, progress);
  return (
    <section
      className={[
        "rounded-2xl border-2 p-5 transition-colors",
        isOnline ? "border-emerald-500/45 bg-emerald-500/[0.04]" : "border-red-500/45 bg-red-500/[0.04]",
      ].join(" ")}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-white/40">
            {t("hangarExec.heroEyebrow")}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <span
              className={[
                "inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold",
                isOnline ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300",
              ].join(" ")}
            >
              <span className={["h-2.5 w-2.5 rounded-full", isOnline ? "bg-emerald-400" : "bg-red-400"].join(" ")} />
              {isOnline ? t("hangarExec.open") : t("hangarExec.closed")}
            </span>
            <span className="text-xs text-white/40">
              {t("hangarExec.cycle")} {status.cycleNumber}
            </span>
          </div>
          <p className="mt-3 font-mono text-3xl font-bold tabular-nums tracking-tight text-white">
            {formatCountdown(secondsRemaining)}
          </p>
          <p className="mt-1 text-xs text-white/40">
            {isOnline ? t("hangarExec.closesIn") : t("hangarExec.opensIn")}
          </p>
        </div>

        <div className="w-full min-w-[220px] max-w-md flex-1 space-y-3">
          <div className="h-3 overflow-hidden rounded-full bg-white/10">
            <div
              className={["h-full rounded-full transition-all duration-1000", isOnline ? "bg-emerald-500" : "bg-red-500"].join(" ")}
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex justify-between gap-1">
            {segments.map((active, i) => (
              <span
                key={i}
                aria-hidden
                className={[
                  "h-3 flex-1 rounded-sm border",
                  active
                    ? isOnline
                      ? "border-emerald-400/60 bg-emerald-500/70"
                      : "border-red-400/60 bg-red-500/70"
                    : "border-white/10 bg-white/[0.04]",
                ].join(" ")}
              />
            ))}
          </div>
          <p className="text-right font-mono text-[10px] tabular-nums text-white/40">
            {progress}% {isOnline ? t("hangarExec.progressOpen") : t("hangarExec.progressClosed")}
          </p>
        </div>
      </div>
    </section>
  );
}

function TerminalCard({
  terminal,
  secondsRemaining,
  onStart,
}: {
  terminal: HangarTerminalPreset;
  secondsRemaining: number | null;
  onStart: () => void;
}) {
  const { t } = useTranslation();
  const active = secondsRemaining != null && secondsRemaining > 0;
  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.02] p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-white/40">{terminal.location}</p>
          <h3 className="text-sm font-semibold text-white">{terminal.label}</h3>
        </div>
        <span className="shrink-0 rounded-full border border-white/10 px-2 py-0.5 font-mono text-[10px] text-white/50">
          30 min
        </span>
      </div>
      <div
        className={[
          "flex items-center justify-between rounded-lg border px-3 py-2",
          active ? "border-[var(--accent)]/30 bg-[var(--accent)]/10" : "border-white/10 bg-black/30",
        ].join(" ")}
      >
        <div className="flex items-center gap-2">
          <Timer className={["h-4 w-4", active ? "text-[var(--accent)]" : "text-white/40"].join(" ")} />
          <span className={["font-mono text-lg tabular-nums", active ? "text-[var(--accent)]" : "text-white/40"].join(" ")}>
            {active ? formatCountdown(secondsRemaining) : "--:--"}
          </span>
        </div>
        <button
          type="button"
          onClick={onStart}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[var(--accent)]/20 px-3 text-xs font-semibold text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/30"
        >
          <Play className="h-3.5 w-3.5" />
          {active ? t("hangarExec.restart") : t("hangarExec.start")}
        </button>
      </div>
    </article>
  );
}

export default function HangarExecPage() {
  const { t } = useTranslation();
  const [statusResp, setStatusResp] = useState<HangarExecStatusResponse | null>(null);
  const [timersResp, setTimersResp] = useState<HangarExecTimersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const load = useCallback(async () => {
    const [s, ti] = await Promise.all([
      invoke<HangarExecStatusResponse>("get_hangar_exec_status").catch(() => null),
      invoke<HangarExecTimersResponse>("get_hangar_exec_timers").catch(() => null),
    ]);
    if (s) setStatusResp(s);
    if (ti) setTimersResp(ti);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(id);
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const timerByTerminalId = useMemo(() => {
    const map = new Map<string, number>();
    for (const ti of timersResp?.activeTimers ?? []) {
      const rem = Math.max(0, Math.floor((ti.endsAtMs - nowMs) / 1000));
      if (rem > 0) map.set(ti.terminalId, rem);
    }
    return map;
  }, [timersResp, nowMs]);

  const grouped = useMemo(() => groupByLocation(timersResp?.terminals ?? []), [timersResp]);

  async function startTimer(id: string) {
    const resp = await invoke<HangarExecTimersResponse>("start_hangar_exec_timer", { terminalId: id }).catch(() => null);
    if (resp) setTimersResp(resp);
  }

  const status = statusResp?.status ?? null;
  const upcoming = statusResp?.upcoming ?? [];

  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-white">
            <Warehouse className="h-6 w-6 text-[var(--accent)]" />
            {t("hangarExec.title")}
          </h1>
          <p className="mt-1 text-sm text-white/50">{t("hangarExec.subtitle")}</p>
        </div>
        <button
          onClick={() => {
            setRefreshing(true);
            void load();
          }}
          disabled={refreshing}
          className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80 transition-colors hover:bg-white/10 disabled:opacity-60"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          {t("hangarExec.refresh")}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-white/50">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("hangarExec.loading")}
        </div>
      ) : (
        <div className="space-y-5">
          {status && <StatusHero status={status} nowMs={nowMs} />}

          {[...grouped.entries()].map(([location, terminals]) => (
            <section key={location}>
              <h2 className="mb-2 px-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-white/40">
                {location}
              </h2>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {terminals.map((term) => (
                  <TerminalCard
                    key={term.id}
                    terminal={term}
                    secondsRemaining={timerByTerminalId.get(term.id) ?? null}
                    onStart={() => void startTimer(term.id)}
                  />
                ))}
              </div>
            </section>
          ))}

          {upcoming.length > 0 && (
            <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
              <h2 className="mb-2 text-sm font-semibold text-white">{t("hangarExec.upcoming")}</h2>
              <ul className="space-y-1.5 text-xs text-white/50">
                {upcoming.slice(0, 8).map((e) => (
                  <li key={`${e.cycleNumber}-${e.atMs}-${e.eventType}`} className="flex items-center justify-between gap-2">
                    <span>
                      {t("hangarExec.cycle")} {e.cycleNumber} ·{" "}
                      {e.eventType === "Online" ? t("hangarExec.evOpen") : t("hangarExec.evClose")}
                    </span>
                    <time className="shrink-0 tabular-nums text-white/70">{new Date(e.atMs).toLocaleString()}</time>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <p className="px-1 text-[11px] text-white/30">
            {t("hangarExec.source")}
            {status?.sourceUrl && (
              <button onClick={() => void openUrl(status.sourceUrl)} className="ml-1 underline hover:text-white/50">
                exec.xyxyll.com
              </button>
            )}
            {status?.lastModified ? ` · ${status.lastModified}` : ""}
            {status?.versionLabel ? ` · SC ${status.versionLabel}` : ""}
          </p>
        </div>
      )}
    </div>
  );
}
