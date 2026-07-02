import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { useTranslation } from "react-i18next";
import {
  X, ArrowRight, MapPin, Check, Navigation, Route as RouteIcon, Clock,
  Lock, LockOpen, Minimize2, Maximize2, Contrast, HandMetal, Fuel,
} from "lucide-react";

/* ──────────────────────────────────────────────────────────────────────────
 * Overlay en jeu (F6) — HUD par-dessus Star Citizen, sans voler le focus.
 * Deux panneaux : ROUTE (itinéraire étape par étape, détails + alerte carburant)
 * et TIMERS (cycle Hangar Exécutif). Réglages (opacité, compact, verrou, clic-
 * traversant, panneaux) persistés en AppMeta « overlay.settings », appliqués en
 * direct. Géométrie de la fenêtre persistée (« overlay.geom »).
 * Route poussée par Cargo & Routes / Crafting / Panier Catalogue.
 * ────────────────────────────────────────────────────────────────────────── */

type OverlayStep = {
  from: string; to: string; commodity?: string; profit?: number;
  scu?: number; minutes?: number; jumps?: number; fuel?: number; distanceGm?: number;
};
type OverlayRoute =
  | { source: "single" | "loop" | "gps" | "cart"; shipName?: string; rangeGm?: number | null; steps: OverlayStep[] }
  | null;

type Settings = {
  opacity: number;
  clickThrough: boolean;
  locked: boolean;
  compact: boolean;
  panels: { route: boolean; timers: boolean };
};
const DEFAULTS: Settings = { opacity: 0.9, clickThrough: false, locked: false, compact: false, panels: { route: true, timers: true } };

type HangarStatus = {
  status: { status: string; secondsRemaining: number; cycleNumber: number; nextChangeMs: number };
  upcoming: Array<{ eventType: string; atMs: number; cycleNumber: number }>;
};

function tokens(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !/^\d+$/.test(w));
}
function score(a: string, b: string): number {
  const A = tokens(a), B = tokens(b);
  if (!A.length || !B.length) return 0;
  return A.filter((x) => B.some((y) => x.includes(y) || y.includes(x))).length;
}
function fmtAuec(n: number | null | undefined): string {
  return n == null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}
function fmtCountdown(sec: number): string {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const pad = (x: number) => String(x).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export default function OverlayApp() {
  const { t } = useTranslation();
  const [route, setRoute] = useState<OverlayRoute>(null);
  const [location, setLocation] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [tab, setTab] = useState<"route" | "timers">("route");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const prev = document.body.style.background;
    document.body.style.background = "transparent";
    return () => { document.body.style.background = prev; };
  }, []);

  // Horloge 1 s (countdowns).
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Réglages : chargement + rechargement sur event (depuis les Paramètres OU l'overlay).
  // Anti-piège : au 1er chargement de la session, le clic-traversant est FORCÉ à OFF
  // (sinon un état persisté "true" rendrait l'overlay définitivement intraversable/inutilisable).
  const initRef = useRef(false);
  useEffect(() => {
    const load = async () => {
      const raw = await invoke<string | null>("get_app_meta", { key: "overlay.settings" }).catch(() => null);
      let parsed: Partial<Settings> = {};
      if (raw) { try { parsed = JSON.parse(raw) as Partial<Settings>; } catch { parsed = {}; } }
      setSettings({
        ...DEFAULTS,
        ...parsed,
        panels: { ...DEFAULTS.panels, ...(parsed.panels ?? {}) },
        clickThrough: initRef.current ? !!parsed.clickThrough : false,
      });
      initRef.current = true;
    };
    void load();
    const un = listen("overlay:settings-changed", () => void load());
    return () => { void un.then((f) => f()); };
  }, []);

  const patchSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((cur) => {
      const next = { ...cur, ...patch };
      void invoke("set_app_meta", { key: "overlay.settings", value: JSON.stringify(next) }).catch(() => {});
      void emit("overlay:settings-changed").catch(() => {});
      return next;
    });
  }, []);

  // Clic-traversant (la souris passe au jeu). Réactivable depuis les Paramètres.
  useEffect(() => {
    void getCurrentWindow().setIgnoreCursorEvents(settings.clickThrough).catch(() => {});
  }, [settings.clickThrough]);

  // Onglet actif borné aux panneaux activés.
  useEffect(() => {
    if (tab === "route" && !settings.panels.route && settings.panels.timers) setTab("timers");
    if (tab === "timers" && !settings.panels.timers && settings.panels.route) setTab("route");
  }, [settings.panels, tab]);

  // Route + lieu détecté.
  const load = useCallback(async () => {
    const [navRaw, loc] = await Promise.all([
      invoke<string | null>("get_app_meta", { key: "overlay.nav" }).catch(() => null),
      invoke<string | null>("get_current_location").catch(() => null),
    ]);
    try { setRoute(navRaw ? (JSON.parse(navRaw) as OverlayRoute) : null); } catch { setRoute(null); }
    setLocation(loc);
  }, []);
  useEffect(() => {
    void load();
    const pNav = listen<OverlayRoute>("overlay:nav", (e) => setRoute(e.payload ?? null));
    const pLoc = listen<{ location: string }>("gamelog:location", (e) => setLocation(e.payload?.location ?? null));
    return () => { void pNav.then((un) => un()); void pLoc.then((un) => un()); };
  }, [load]);

  // Persistance géométrie fenêtre (restaure au montage, sauve à move/resize débouncé).
  useEffect(() => {
    const w = getCurrentWindow();
    (async () => {
      const raw = await invoke<string | null>("get_app_meta", { key: "overlay.geom" }).catch(() => null);
      if (!raw) return;
      const [x, y, ww, hh] = raw.split(",").map(Number);
      if ([x, y, ww, hh].every((n) => Number.isFinite(n))) {
        try { await w.setSize(new PhysicalSize(ww, hh)); await w.setPosition(new PhysicalPosition(x, y)); } catch { /* ignore */ }
      }
    })();
    let tid: number | undefined;
    const save = async () => {
      try {
        const p = await w.outerPosition(); const s = await w.innerSize();
        void invoke("set_app_meta", { key: "overlay.geom", value: `${p.x},${p.y},${s.width},${s.height}` });
      } catch { /* ignore */ }
    };
    const debounced = () => { if (tid) clearTimeout(tid); tid = window.setTimeout(save, 500); };
    const un1 = w.onMoved(debounced); const un2 = w.onResized(debounced);
    return () => { if (tid) clearTimeout(tid); void un1.then((f) => f()); void un2.then((f) => f()); };
  }, []);

  const steps = route?.steps ?? [];

  const activeIndex = useMemo(() => {
    if (steps.length === 0) return 0;
    if (!location) return 0;
    let best = -1, bestSc = 0;
    steps.forEach((s, i) => { const sc = score(location, s.from); if (sc > bestSc) { bestSc = sc; best = i; } });
    if (best >= 0) return best;
    let bestTo = -1, bestToSc = 0;
    steps.forEach((s, i) => { const sc = score(location, s.to); if (sc > bestToSc) { bestToSc = sc; bestTo = i; } });
    if (bestTo >= 0) return Math.min(bestTo + 1, steps.length - 1);
    return 0;
  }, [steps, location]);

  // Étape où la distance cumulée dépasse l'autonomie → ravitaillement nécessaire.
  const refuelIndex = useMemo(() => {
    const r = route?.rangeGm ?? 0;
    if (!r || r <= 0) return -1;
    let acc = 0;
    for (let i = 0; i < steps.length; i++) { acc += steps[i].distanceGm ?? 0; if (acc > r) return i; }
    return -1;
  }, [route, steps]);

  const totalProfit = steps.reduce((a, s) => a + (s.profit ?? 0), 0);
  const hasProfit = steps.some((s) => s.profit != null);

  const bothPanels = settings.panels.route && settings.panels.timers;
  const showRoute = settings.panels.route && (tab === "route" || !settings.panels.timers);
  const showTimers = settings.panels.timers && (tab === "timers" || !settings.panels.route);

  const iconBtn = "flex h-5 w-5 items-center justify-center rounded text-white/45 hover:bg-white/10 hover:text-white";

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden p-1.5 text-white" style={{ opacity: settings.opacity }}>
      <div className="flex h-full flex-col overflow-hidden rounded-xl border border-white/15 bg-[#0a0a0f]/85 backdrop-blur-md">
        {/* En-tête = poignée (sauf si verrouillé) + contrôles rapides */}
        <div
          {...(settings.locked ? {} : { "data-tauri-drag-region": true })}
          className={`flex select-none items-center gap-1 border-b border-white/10 px-2.5 py-1.5 ${settings.locked ? "" : "cursor-move"}`}
        >
          <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[var(--accent)]">
            <Navigation className="h-3.5 w-3.5" />
            {t("overlay.route")}
          </span>
          <div className="ml-auto flex items-center gap-0.5">
            <button className={iconBtn} title={t("overlay.lock")} onClick={() => patchSettings({ locked: !settings.locked })}>
              {settings.locked ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
            </button>
            <button
              className={`${iconBtn} ${settings.clickThrough ? "text-[var(--accent)]" : ""}`}
              title={t("overlay.clickThrough")}
              onClick={() => patchSettings({ clickThrough: !settings.clickThrough })}
            >
              <HandMetal className="h-3.5 w-3.5" />
            </button>
            <button className={iconBtn} title={t("overlay.compact")} onClick={() => patchSettings({ compact: !settings.compact })}>
              {settings.compact ? <Maximize2 className="h-3.5 w-3.5" /> : <Minimize2 className="h-3.5 w-3.5" />}
            </button>
            <button className={iconBtn} title={t("overlay.opacity")} onClick={() => patchSettings({ opacity: settings.opacity <= 0.55 ? 1 : Math.round((settings.opacity - 0.15) * 100) / 100 })}>
              <Contrast className="h-3.5 w-3.5" />
            </button>
            <button className={iconBtn} title={t("overlay.close")} onClick={() => void invoke("hide_overlay").catch(() => {})}>
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Onglets (si les deux panneaux sont activés et pas en compact) */}
        {bothPanels && !settings.compact && (
          <div className="flex gap-1 px-2 pt-1.5">
            <Tab active={tab === "route"} onClick={() => setTab("route")} icon={<RouteIcon className="h-3 w-3" />} label={t("overlay.tabRoute")} />
            <Tab active={tab === "timers"} onClick={() => setTab("timers")} icon={<Clock className="h-3 w-3" />} label={t("overlay.tabTimers")} />
          </div>
        )}

        {settings.compact ? (
          <CompactBar steps={steps} activeIndex={activeIndex} refuelIndex={refuelIndex} t={t} />
        ) : (
          <div className="flex-1 overflow-auto p-2.5">
            {showRoute && (
              <RoutePanel
                steps={steps} activeIndex={activeIndex} refuelIndex={refuelIndex}
                location={location} shipName={route?.shipName} totalProfit={totalProfit} hasProfit={hasProfit} t={t}
              />
            )}
            {showTimers && <TimersPanel now={now} t={t} />}
          </div>
        )}

        <div className="border-t border-white/10 px-3 py-1 text-center text-[10px] text-white/30">{t("overlay.hint")}</div>
      </div>
    </div>
  );
}

function Tab({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: ReactNode; label: string }) {
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
function RoutePanel({ steps, activeIndex, refuelIndex, location, shipName, totalProfit, hasProfit, t }: {
  steps: OverlayStep[]; activeIndex: number; refuelIndex: number; location: string | null;
  shipName?: string; totalProfit: number; hasProfit: boolean; t: ReturnType<typeof useTranslation>["t"];
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
          {hasProfit && <span className="ml-1.5 font-semibold text-[#5dcaa5]">+{fmtAuec(totalProfit)}</span>}
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
                  {s.profit != null && <span className="flex-none font-semibold text-[#5dcaa5]">+{fmtAuec(s.profit)}</span>}
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {s.scu != null && <Chip>{Math.round(s.scu)} SCU</Chip>}
                  {s.minutes != null && <Chip icon={<ArrowRight className="h-2.5 w-2.5" />}>{s.minutes.toFixed(1)} {t("cargo.unit.min")}{s.jumps ? ` · ${s.jumps}⤳` : ""}</Chip>}
                  {i === refuelIndex && <Chip tone="fuel" icon={<Fuel className="h-2.5 w-2.5" />}>{t("overlay.refuel")}</Chip>}
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

function Chip({ children, icon, tone }: { children: ReactNode; icon?: ReactNode; tone?: "fuel" }) {
  const cls = tone === "fuel"
    ? "bg-[#f0997b]/14 text-[#f0997b]"
    : "bg-white/6 text-white/55";
  return <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[10px] ${cls}`}>{icon}{children}</span>;
}

/* ── Barre compacte (étape courante uniquement) ── */
function CompactBar({ steps, activeIndex, refuelIndex, t }: {
  steps: OverlayStep[]; activeIndex: number; refuelIndex: number; t: ReturnType<typeof useTranslation>["t"];
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

/* ── Panneau Timers (Hangar Exécutif) ── */
function TimersPanel({ now, t }: { now: number; t: ReturnType<typeof useTranslation>["t"] }) {
  const [hangar, setHangar] = useState<HangarStatus | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () => invoke<HangarStatus>("get_hangar_exec_status").then((h) => alive && setHangar(h)).catch(() => alive && setErr(true));
    void load();
    const id = window.setInterval(load, 30000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  if (err && !hangar) return <div className="flex h-full items-center justify-center px-3 text-center text-[11px] text-white/40">{t("overlay.hangarError")}</div>;
  if (!hangar) return <div className="flex h-full items-center justify-center text-[11px] text-white/40">…</div>;

  const online = hangar.status.status === "ONLINE";
  const remain = Math.max(0, (hangar.status.nextChangeMs - now) / 1000);
  const nextOpen = hangar.upcoming.find((u) => u.eventType === "Online");
  const nextOpenIn = nextOpen ? Math.max(0, (nextOpen.atMs - now) / 1000) : null;

  return (
    <div>
      <div className="mb-1.5 text-[11px] uppercase tracking-wider text-white/40">{t("overlay.hangarTitle")}</div>
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
    </div>
  );
}
