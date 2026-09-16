import { useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { TFunction } from "i18next";
import { ArrowRight, Check, MapPin, Route as RouteIcon, Clock, Fuel } from "lucide-react";
import type { OverlaySettings } from "../../lib/overlayPreferences";

/* Pièces présentationnelles du HUD overlay, partagées par la fenêtre in-game
   (OverlayApp) ET l'aperçu de la page Overlay. Déplacement pur depuis OverlayApp —
   seul ajout : les panneaux Timers acceptent des données injectées (`sample`) pour
   l'aperçu, ce qui court-circuite le polling `invoke`. */

export type OverlayStep = {
  from: string; to: string; commodity?: string; profit?: number;
  scu?: number; minutes?: number; jumps?: number; fuel?: number; distanceGm?: number;
};
export type OverlayRoute =
  | { source: "single" | "loop" | "gps" | "cart"; shipName?: string; rangeGm?: number | null; steps: OverlayStep[] }
  | null;

export type RouteDetails = OverlaySettings["routeDetails"];

export type HangarStatus = {
  status: { status: string; secondsRemaining: number; cycleNumber: number; nextChangeMs: number };
  upcoming: Array<{ eventType: string; atMs: number; cycleNumber: number }>;
};
export type HangarTimers = {
  terminals: Array<{ id: string; label: string; location: string; timerSeconds: number }>;
  activeTimers: Array<{ terminalId: string; endsAtMs: number; secondsRemaining: number }>;
};

/** Données Timers injectables (aperçu). `undefined` = polling live (fenêtre réelle). */
export type TimersSample = { hangar: HangarStatus | null; timers: HangarTimers | null };

export function fmtAuec(n: number | null | undefined): string {
  return n == null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}
export function fmtCountdown(sec: number): string {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const pad = (x: number) => String(x).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function Tab({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-t-lg px-2 py-1 text-[11px] font-medium ${active ? "bg-[var(--accent)]/15 text-[var(--accent)]" : "text-white/45 hover:text-white/70"}`}
    >
      {icon} {label}
    </button>
  );
}

/* ── Panneau Route ── */
export function RoutePanel({ steps, activeIndex, refuelIndex, location, shipName, totalProfit, hasProfit, details, t }: {
  steps: OverlayStep[]; activeIndex: number; refuelIndex: number; location: string | null;
  shipName?: string; totalProfit: number; hasProfit: boolean; details: RouteDetails; t: TFunction;
}) {
  if (steps.length === 0) {
    return <div className="flex h-full items-center justify-center px-3 text-center text-[11px] text-white/40">{t("overlay.noRoute")}</div>;
  }
  return (
    <>
      <div className="mb-2 flex items-center justify-between gap-2 px-1 text-[11px]">
        <span className="truncate text-white/35">{shipName ?? ""}</span>
        <span className="flex-none text-white/50">
          {activeIndex}/{steps.length}
          {hasProfit && details.profit && <span className="ml-1.5 font-semibold text-[#5dcaa5]">+{fmtAuec(totalProfit)}</span>}
        </span>
      </div>
      <div className="mb-2.5 h-1 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${steps.length ? (activeIndex / steps.length) * 100 : 0}%` }} />
      </div>
      <div>
        {steps.map((s, i) => {
          const done = i < activeIndex, active = i === activeIndex;
          const color = active ? "var(--accent)" : done ? "#3f4452" : "#60a5fa";
          return (
            <div key={i} className="flex gap-2.5">
              <div className="flex w-5 flex-none flex-col items-center">
                <div className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold"
                  style={{ background: active ? "var(--accent)" : `${color}22`, color: active ? "#15110a" : color, border: active ? "none" : `1px solid ${color}55` }}>
                  {done ? <Check className="h-3 w-3" /> : i + 1}
                </div>
                {i < steps.length - 1 && <div className="my-0.5 w-px flex-1 bg-white/12" />}
              </div>
              <div className={`mb-1.5 min-w-0 flex-1 rounded-lg px-2 py-1.5 ${active ? "border border-[var(--accent)]/40 bg-[var(--accent)]/[0.07]" : ""} ${done ? "opacity-45" : ""}`}>
                <div className="flex items-center gap-1.5 text-[13px] font-semibold">
                  <span className="min-w-0 truncate text-white/70">{s.from}</span>
                  <ArrowRight className="h-3 w-3 flex-none text-[var(--accent)]" />
                  <span className="min-w-0 truncate text-white">{s.to}</span>
                </div>
                <div className="mt-0.5 flex items-center justify-between gap-2 text-[11px]">
                  <span className="min-w-0 truncate text-white/55">{s.commodity ?? "—"}</span>
                  {s.profit != null && details.profit && <span className="flex-none font-semibold text-[#5dcaa5]">+{fmtAuec(s.profit)}</span>}
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {details.scu && s.scu != null && <Chip>{Math.round(s.scu)} SCU</Chip>}
                  {details.time && s.minutes != null && <Chip icon={<ArrowRight className="h-2.5 w-2.5" />}>{s.minutes.toFixed(1)} {t("cargo.unit.min")}{s.jumps ? ` · ${s.jumps}⤳` : ""}</Chip>}
                  {details.fuel && i === refuelIndex && <Chip tone="fuel" icon={<Fuel className="h-2.5 w-2.5" />}>{t("overlay.refuel")}</Chip>}
                </div>
                {active && location && (
                  <div className="mt-1 flex items-center gap-1 text-[10px] text-[var(--accent)]"><MapPin className="h-3 w-3" /> {t("overlay.youAreHere")}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

export function Chip({ children, icon, tone }: { children: ReactNode; icon?: ReactNode; tone?: "fuel" }) {
  const cls = tone === "fuel"
    ? "bg-[#f0997b]/14 text-[#f0997b]"
    : "bg-white/6 text-white/55";
  return <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[10px] ${cls}`}>{icon}{children}</span>;
}

/* ── Barre compacte (étape courante uniquement) ── */
export function CompactBar({ steps, activeIndex, refuelIndex, t }: {
  steps: OverlayStep[]; activeIndex: number; refuelIndex: number; t: TFunction;
}) {
  const s = steps[activeIndex];
  if (!s) return <div className="p-2 text-center text-[11px] text-white/40">{t("overlay.noRoute")}</div>;
  return (
    <div className="flex items-center gap-2 px-2.5 py-2">
      <span className="flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full bg-[var(--accent)] text-[10px] font-bold text-[#15110a]">{activeIndex + 1}</span>
      <span className="flex min-w-0 flex-1 items-center gap-1 text-[12px]">
        <span className="min-w-0 truncate text-white/70">{s.from}</span>
        <ArrowRight className="h-3 w-3 flex-none text-[var(--accent)]" />
        <span className="min-w-0 truncate text-white">{s.to}</span>
      </span>
      {activeIndex === refuelIndex && <Fuel className="h-3.5 w-3.5 flex-none text-[#f0997b]" />}
      {s.profit != null && <span className="flex-none text-[12px] font-semibold text-[#5dcaa5]">+{fmtAuec(s.profit)}</span>}
    </div>
  );
}

/* ── Projection légère : lisible au-dessus du HUD, sans panneau opaque ── */
export function ProjectionRoute({ steps, activeIndex, refuelIndex, details, totalProfit, hasProfit, t }: {
  steps: OverlayStep[]; activeIndex: number; refuelIndex: number; details: RouteDetails;
  totalProfit: number; hasProfit: boolean; t: TFunction;
}) {
  const step = steps[activeIndex];
  if (!step) {
    return <div className="flex items-center justify-center px-3 py-8 text-center text-[11px] text-white/45">{t("overlay.noRoute")}</div>;
  }
  const progress = steps.length > 1 ? ((activeIndex + 1) / steps.length) * 100 : 100;
  return (
    <div className="p-3 font-mono text-[10px] uppercase tracking-wide text-white/75">
      <div className="text-[9px] tracking-[0.18em] text-white/45">{t("overlay.route")} · {activeIndex + 1}/{steps.length}</div>
      <div className="mt-1.5 flex items-center justify-between gap-2 text-[15px] font-semibold tracking-normal">
        <span className="min-w-0 truncate text-white">{step.to}</span>
        {details.time && step.minutes != null && <span className="flex-none text-[11px] text-[var(--accent)]">{step.minutes.toFixed(1)} {t("cargo.unit.min")}</span>}
      </div>
      <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-white/55">
        <span className="min-w-0 truncate">{step.commodity ?? "—"}{details.scu && step.scu != null ? ` · ${Math.round(step.scu)} SCU` : ""}</span>
        {hasProfit && details.profit && <span className="flex-none text-[#5dcaa5]">+{fmtAuec(totalProfit)} aUEC</span>}
      </div>
      <div className="mt-2 h-px bg-[var(--accent)]/20">
        <div className="h-px bg-[var(--accent)] shadow-[0_0_7px_var(--accent)]" style={{ width: `${progress}%` }} />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-[9px]">
        {activeIndex === refuelIndex ? <span className="flex items-center gap-1 text-[#f0997b]"><Fuel className="h-3 w-3" /> {t("overlay.refuel")}</span> : <span className="text-white/35">{step.from}</span>}
        <span className="text-white/35">F6</span>
      </div>
    </div>
  );
}

/* ── Panneau Timers (cycle Hangar + timers indépendants par terminal) ── */
export function TimersPanel({ now, cycle, independent, paused = false, sample, t }: {
  now: number; cycle: boolean; independent: boolean; paused?: boolean; sample?: TimersSample; t: TFunction;
}) {
  const [hangar, setHangar] = useState<HangarStatus | null>(sample?.hangar ?? null);
  const [timers, setTimers] = useState<HangarTimers | null>(sample?.timers ?? null);
  const [err, setErr] = useState(false);
  const live = sample === undefined;

  useEffect(() => {
    if (!live) { setHangar(cycle ? (sample?.hangar ?? null) : null); return; }
    if (!cycle || paused) { if (!cycle) setHangar(null); return; }
    let alive = true;
    const load = () => invoke<HangarStatus>("get_hangar_exec_status").then((h) => alive && setHangar(h)).catch(() => alive && setErr(true));
    void load();
    const id = window.setInterval(load, 30000);
    return () => { alive = false; clearInterval(id); };
  }, [cycle, paused, live, sample]);

  useEffect(() => {
    if (!live) { setTimers(independent ? (sample?.timers ?? null) : null); return; }
    if (!independent || paused) { if (!independent) setTimers(null); return; }
    let alive = true;
    const load = () => invoke<HangarTimers>("get_hangar_exec_timers").then((x) => alive && setTimers(x)).catch(() => {});
    void load();
    const id = window.setInterval(load, 15000);
    return () => { alive = false; clearInterval(id); };
  }, [independent, paused, live, sample]);

  if (!cycle && !independent) {
    return <div className="flex h-full items-center justify-center px-3 text-center text-[11px] text-white/40">{t("overlay.noTimers")}</div>;
  }

  const online = hangar?.status.status === "ONLINE";
  const remain = hangar ? Math.max(0, (hangar.status.nextChangeMs - now) / 1000) : 0;
  const nextOpen = hangar?.upcoming.find((u) => u.eventType === "Online");
  const nextOpenIn = nextOpen ? Math.max(0, (nextOpen.atMs - now) / 1000) : null;
  const labelOf = (id: string) => timers?.terminals.find((tm) => tm.id === id)?.label ?? id;
  const active = (timers?.activeTimers ?? []).filter((a) => a.endsAtMs > now);

  return (
    <div className="flex flex-col gap-3">
      {cycle && (
        <div>
          <div className="mb-1.5 text-[11px] uppercase tracking-wider text-white/40">{t("overlay.hangarTitle")}</div>
          {err && !hangar ? (
            <div className="text-[11px] text-white/40">{t("overlay.hangarError")}</div>
          ) : !hangar ? (
            <div className="text-[11px] text-white/40">…</div>
          ) : (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-[20px] font-semibold" style={{ color: online ? "#5dcaa5" : "#f0997b" }}>
                  {online ? t("overlay.open") : t("overlay.closed")}
                </span>
                <span className="text-[11px] text-white/45">{t("overlay.cycle")} #{hangar.status.cycleNumber}</span>
              </div>
              <div className="mt-0.5 text-[13px] text-white/80">
                {online ? t("overlay.closesIn") : t("overlay.opensIn")}{" "}
                <span className="font-semibold text-[var(--accent)]">{fmtCountdown(remain)}</span>
              </div>
              {!online && nextOpenIn != null && (
                <div className="mt-1.5 text-[11px] text-white/40">{t("overlay.nextOpen")} · {fmtCountdown(nextOpenIn)}</div>
              )}
            </>
          )}
        </div>
      )}

      {independent && (
        <div className={cycle ? "border-t border-white/10 pt-2.5" : ""}>
          <div className="mb-1.5 text-[11px] uppercase tracking-wider text-white/40">{t("overlay.independentTimers")}</div>
          {active.length === 0 ? (
            <div className="text-[11px] text-white/40">{t("overlay.noActiveTimers")}</div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {active
                .slice()
                .sort((a, b) => a.endsAtMs - b.endsAtMs)
                .map((a) => (
                  <div key={a.terminalId} className="flex items-center justify-between gap-2 rounded-lg bg-white/5 px-2.5 py-1.5">
                    <span className="min-w-0 truncate text-[12px] text-white/80">{labelOf(a.terminalId)}</span>
                    <span className="flex-none text-[13px] font-semibold text-[var(--accent)]">{fmtCountdown((a.endsAtMs - now) / 1000)}</span>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Résumé Timers compact (mode compact / projection) : cycle Hangar + timer le + urgent ── */
export function TimersSummary({ now, paused, cycle, independent, projection = false, sample, t }: {
  now: number; paused: boolean; cycle: boolean; independent: boolean; projection?: boolean; sample?: TimersSample; t: TFunction;
}) {
  const [hangar, setHangar] = useState<HangarStatus | null>(sample?.hangar ?? null);
  const [timers, setTimers] = useState<HangarTimers | null>(sample?.timers ?? null);
  const live = sample === undefined;

  useEffect(() => {
    if (!live) { setHangar(sample?.hangar ?? null); return; }
    if (!cycle || paused) return;
    let alive = true;
    const load = () => invoke<HangarStatus>("get_hangar_exec_status").then((h) => alive && setHangar(h)).catch(() => {});
    void load();
    const id = window.setInterval(load, 30000);
    return () => { alive = false; clearInterval(id); };
  }, [cycle, paused, live, sample]);
  useEffect(() => {
    if (!live) { setTimers(sample?.timers ?? null); return; }
    if (!independent || paused) return;
    let alive = true;
    const load = () => invoke<HangarTimers>("get_hangar_exec_timers").then((x) => alive && setTimers(x)).catch(() => {});
    void load();
    const id = window.setInterval(load, 15000);
    return () => { alive = false; clearInterval(id); };
  }, [independent, paused, live, sample]);

  const online = hangar?.status.status === "ONLINE";
  const remain = hangar ? Math.max(0, (hangar.status.nextChangeMs - now) / 1000) : 0;
  const nextTimer = (timers?.activeTimers ?? [])
    .filter((a) => a.endsAtMs > now)
    .sort((a, b) => a.endsAtMs - b.endsAtMs)[0];
  const nextLabel = nextTimer ? timers?.terminals.find((tm) => tm.id === nextTimer.terminalId)?.label ?? nextTimer.terminalId : null;

  if (!cycle && !independent) {
    return <div className={`px-3 ${projection ? "py-8" : "py-2"} text-center text-[11px] text-white/40`}>{t("overlay.noTimers")}</div>;
  }

  const box = projection ? "p-3 font-mono text-[10px] uppercase tracking-wide" : "flex items-center gap-2 px-2.5 py-2";
  return (
    <div className={box}>
      {cycle && (
        <span className={projection ? "flex items-center justify-between gap-2" : "flex items-center gap-1.5"}>
          <span className="text-[13px] font-semibold" style={{ color: online ? "#5dcaa5" : "#f0997b" }}>
            {online ? t("overlay.open") : t("overlay.closed")}
          </span>
          {hangar && <span className="text-[13px] font-semibold text-[var(--accent)]">{fmtCountdown(remain)}</span>}
        </span>
      )}
      {independent && nextTimer && (
        <span className={`flex min-w-0 items-center gap-1.5 ${cycle ? (projection ? "mt-1.5" : "ml-auto") : ""}`}>
          <span className="min-w-0 truncate text-[11px] text-white/60">{nextLabel}</span>
          <span className="flex-none text-[12px] font-semibold text-[var(--accent)]">{fmtCountdown((nextTimer.endsAtMs - now) / 1000)}</span>
        </span>
      )}
      {cycle && !hangar && !nextTimer && <span className="text-[11px] text-white/40">…</span>}
    </div>
  );
}

/* ── Corps du HUD : onglets + contenu (route/timers) + pied, selon style/compact/panneaux.
   Partagé par OverlayApp (données live) et l'aperçu (données injectées via `sampleTimers`). */
export function OverlayHudBody({
  settings, tab, setTab, steps, activeIndex, refuelIndex, location, shipName,
  totalProfit, hasProfit, now, visible, sampleTimers, t,
}: {
  settings: OverlaySettings; tab: "route" | "timers"; setTab: (k: "route" | "timers") => void;
  steps: OverlayStep[]; activeIndex: number; refuelIndex: number; location: string | null; shipName?: string;
  totalProfit: number; hasProfit: boolean; now: number; visible: boolean; sampleTimers?: TimersSample; t: TFunction;
}) {
  const bothPanels = settings.panels.route && settings.panels.timers;
  const showRoute = settings.panels.route && (tab === "route" || !settings.panels.timers);
  const showTimers = settings.panels.timers && (tab === "timers" || !settings.panels.route);
  const isProjection = settings.visualStyle === "projection";
  const compactTimers = showTimers && !showRoute;

  return (
    <>
      {/* Onglets (si les deux panneaux sont activés et pas en compact) — ordre = onglet par défaut d'abord */}
      {!isProjection && bothPanels && !settings.compact && (
        <div className="flex gap-1 px-2 pt-1.5">
          {(settings.defaultTab === "timers" ? (["timers", "route"] as const) : (["route", "timers"] as const)).map((k) => (
            <Tab
              key={k}
              active={tab === k}
              onClick={() => setTab(k)}
              icon={k === "route" ? <RouteIcon className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
              label={k === "route" ? t("overlay.tabRoute") : t("overlay.tabTimers")}
            />
          ))}
        </div>
      )}

      {isProjection ? (
        compactTimers ? (
          <TimersSummary now={now} paused={!visible} cycle={settings.timers.hangar} independent={settings.timers.independent} projection sample={sampleTimers} t={t} />
        ) : (
          <ProjectionRoute
            steps={steps} activeIndex={activeIndex} refuelIndex={refuelIndex} details={settings.routeDetails}
            totalProfit={totalProfit} hasProfit={hasProfit} t={t}
          />
        )
      ) : settings.compact ? (
        compactTimers ? (
          <TimersSummary now={now} paused={!visible} cycle={settings.timers.hangar} independent={settings.timers.independent} sample={sampleTimers} t={t} />
        ) : (
          <CompactBar steps={steps} activeIndex={activeIndex} refuelIndex={refuelIndex} t={t} />
        )
      ) : (
        <div className="flex-1 overflow-auto p-2.5">
          {showRoute && (
            <RoutePanel
              steps={steps} activeIndex={activeIndex} refuelIndex={refuelIndex} details={settings.routeDetails}
              location={location} shipName={shipName} totalProfit={totalProfit} hasProfit={hasProfit} t={t}
            />
          )}
          {showTimers && (
            <TimersPanel now={now} paused={!visible} cycle={settings.timers.hangar} independent={settings.timers.independent} sample={sampleTimers} t={t} />
          )}
        </div>
      )}

      {(!isProjection || settings.clickThrough) && (
        <div className={`border-t px-3 py-1 text-center text-[10px] ${settings.clickThrough ? "border-[#f0b56b]/25 text-[#f0b56b]/80" : "border-white/10 text-white/30"}`}>
          {settings.clickThrough ? t("overlay.clickThroughOn") : t("overlay.hint")}
        </div>
      )}
    </>
  );
}
