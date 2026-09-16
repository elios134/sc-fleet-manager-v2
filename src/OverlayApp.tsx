import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow, availableMonitors } from "@tauri-apps/api/window";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { useTranslation } from "react-i18next";
import {
  X, Navigation, Clock, Lock, LockOpen, Minimize2, Maximize2,
  Contrast, HandMetal, ChevronLeft, ChevronRight, LocateFixed, HelpCircle,
} from "lucide-react";
import {
  createOverlayDefaults,
  normalizeOverlaySettings,
  type OverlaySettings,
} from "./lib/overlayPreferences";
import { OverlayHudBody, type OverlayRoute } from "./components/overlay/hudParts";

/* ──────────────────────────────────────────────────────────────────────────
 * Overlay en jeu (F6) — HUD par-dessus Star Citizen, sans voler le focus.
 * Deux panneaux : ROUTE (itinéraire étape par étape, détails + alerte carburant)
 * et TIMERS (cycle Hangar Exécutif). Réglages (opacité, compact, verrou, clic-
 * traversant, panneaux) persistés en AppMeta « overlay.settings », appliqués en
 * direct. Géométrie de la fenêtre persistée (« overlay.geom »).
 * Route poussée par Cargo & Routes / Crafting / Panier Catalogue.
 * ────────────────────────────────────────────────────────────────────────── */

function tokens(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !/^\d+$/.test(w));
}
function score(a: string, b: string): number {
  const A = tokens(a), B = tokens(b);
  if (!A.length || !B.length) return 0;
  return A.filter((x) => B.some((y) => x.includes(y) || y.includes(x))).length;
}

export default function OverlayApp() {
  const { t } = useTranslation();
  const [route, setRoute] = useState<OverlayRoute>(null);
  const [location, setLocation] = useState<string | null>(null);
  const [settings, setSettings] = useState<OverlaySettings>(createOverlayDefaults);
  const [tab, setTab] = useState<"route" | "timers">("route");
  const [now, setNow] = useState(() => Date.now());
  // Override manuel de l'étape (◀/▶). null = suivi auto piloté par le lieu détecté.
  const [manualIndex, setManualIndex] = useState<number | null>(null);

  useEffect(() => {
    const prev = document.body.style.background;
    document.body.style.background = "transparent";
    return () => { document.body.style.background = prev; };
  }, []);

  // Visibilité de la fenêtre (émise par le backend show/hide) → met en pause horloge et
  // polling des timers quand l'overlay est masqué (F6), pour ne rien consommer en fond.
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const un = listen<boolean>("overlay:visibility", (e) => setVisible(e.payload !== false));
    return () => { void un.then((f) => f()); };
  }, []);

  // Horloge 1 s (countdowns) — arrêtée quand l'overlay est masqué.
  useEffect(() => {
    if (!visible) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [visible]);

  // Réglages : chargement + rechargement sur event (depuis les Paramètres OU l'overlay).
  // Anti-piège : au 1er chargement de la session, le clic-traversant est FORCÉ à OFF
  // (sinon un état persisté "true" rendrait l'overlay définitivement intraversable/inutilisable).
  const initRef = useRef(false);
  useEffect(() => {
    const load = async () => {
      const raw = await invoke<string | null>("get_app_meta", { key: "overlay.settings" }).catch(() => null);
      let parsed: Partial<OverlaySettings> = {};
      if (raw) { try { parsed = JSON.parse(raw) as Partial<OverlaySettings>; } catch { parsed = {}; } }
      const next = { ...normalizeOverlaySettings(parsed), clickThrough: initRef.current ? !!parsed.clickThrough : false };
      setSettings(next);
      // Onglet par défaut au 1er chargement de la session.
      if (!initRef.current) setTab(next.defaultTab === "timers" && next.panels.timers ? "timers" : "route");
      initRef.current = true;
    };
    void load();
    const un = listen("overlay:settings-changed", () => void load());
    return () => { void un.then((f) => f()); };
  }, []);

  const patchSettings = useCallback((patch: Partial<OverlaySettings>) => {
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

  // Anti-piège : F7 (hook global backend) bascule le clic-traversant même quand l'overlay
  // est intraversable — sans quoi, une fois activé, aucun bouton n'est plus cliquable.
  const ctRef = useRef(settings.clickThrough);
  ctRef.current = settings.clickThrough;
  useEffect(() => {
    const un = listen("overlay:toggle-clickthrough", () => patchSettings({ clickThrough: !ctRef.current }));
    return () => { void un.then((f) => f()); };
  }, [patchSettings]);

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
      if (![x, y, ww, hh].every((n) => Number.isFinite(n))) return;
      // Clamp multi-écran : si la position sauvée n'est sur aucun moniteur (config d'écrans
      // changée), on recale sur le 1er moniteur au lieu de réapparaître hors champ.
      let px = x, py = y;
      try {
        const mons = await availableMonitors();
        const onScreen = mons.some(
          (m) => x + 40 > m.position.x && x < m.position.x + m.size.width && y + 20 > m.position.y && y < m.position.y + m.size.height,
        );
        if (!onScreen && mons.length) { px = mons[0].position.x + 40; py = mons[0].position.y + 40; }
      } catch { /* pas de moniteurs → on garde la position telle quelle */ }
      try { await w.setSize(new PhysicalSize(ww, hh)); await w.setPosition(new PhysicalPosition(px, py)); } catch { /* ignore */ }
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

  // Nouvelle route poussée → on repart en suivi auto.
  useEffect(() => { setManualIndex(null); }, [route]);

  const autoIndex = useMemo(() => {
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

  // Le lieu détecté correspond-il à une étape ? (sinon → « position inconnue »).
  const locMatched = useMemo(() => {
    if (!location || steps.length === 0) return false;
    return steps.some((s) => score(location, s.from) > 0 || score(location, s.to) > 0);
  }, [location, steps]);

  // Étape effective : override manuel prioritaire, sinon suivi auto (borné).
  const activeIndex = manualIndex != null ? Math.min(Math.max(0, manualIndex), Math.max(0, steps.length - 1)) : autoIndex;
  const isManual = manualIndex != null;
  const locUnknown = steps.length > 0 && !isManual && !locMatched;
  const goPrev = () => setManualIndex(Math.max(0, activeIndex - 1));
  const goNext = () => setManualIndex(Math.min(steps.length - 1, activeIndex + 1));

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

  const showRoute = settings.panels.route && (tab === "route" || !settings.panels.timers);
  const showTimers = settings.panels.timers && (tab === "timers" || !settings.panels.route);
  const isProjection = settings.visualStyle === "projection";
  // Contenu actif en mode compact/projection : timers si c'est le panneau courant, sinon route.
  const compactTimers = showTimers && !showRoute;
  // Vue « route » active → contrôles ◀/▶ (pas en vue timers).
  const routeView = steps.length > 0 && !compactTimers && (isProjection || settings.compact || showRoute);
  const headerIsTimers = compactTimers || (!routeView && showTimers);

  const iconBtn = "flex h-5 w-5 items-center justify-center rounded text-white/45 hover:bg-white/10 hover:text-white";

  return (
    <div className={`flex h-screen w-screen flex-col overflow-hidden text-white ${isProjection ? "p-2" : "p-1.5"}`} style={{ opacity: settings.opacity }}>
      <div className={`flex h-full flex-col overflow-hidden ${isProjection ? "border border-[var(--accent)]/35 bg-transparent" : "rounded-xl border border-white/15 bg-[#0a0a0f]/85 backdrop-blur-md"}`}>
        {/* En-tête = poignée (sauf si verrouillé) + contrôles rapides */}
        <div
          {...(settings.locked ? {} : { "data-tauri-drag-region": true })}
          className={`flex select-none items-center gap-1 border-b px-2.5 py-1.5 ${isProjection ? "border-[var(--accent)]/25 bg-[var(--accent)]/[0.03]" : "border-white/10"} ${settings.locked ? "" : "cursor-move"}`}
        >
          <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[var(--accent)]">
            {headerIsTimers ? <Clock className="h-3.5 w-3.5" /> : <Navigation className="h-3.5 w-3.5" />}
            {headerIsTimers ? t("overlay.tabTimers") : t("overlay.route")}
          </span>

          {/* Contrôles d'étape : override manuel ◀/▶ + retour au suivi auto + état du lieu */}
          {routeView && (
            <div className="ml-2 flex items-center gap-0.5">
              <button className={`${iconBtn} disabled:opacity-25`} title={t("overlay.prev")} onClick={goPrev} disabled={activeIndex <= 0}>
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span className="min-w-[30px] text-center text-[10px] tabular-nums text-white/55">{activeIndex + 1}/{steps.length}</span>
              <button className={`${iconBtn} disabled:opacity-25`} title={t("overlay.next")} onClick={goNext} disabled={activeIndex >= steps.length - 1}>
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
              {isManual ? (
                <button className={`${iconBtn} text-[var(--accent)]`} title={t("overlay.autoTrack")} onClick={() => setManualIndex(null)}>
                  <LocateFixed className="h-3.5 w-3.5" />
                </button>
              ) : locUnknown ? (
                <span className="flex items-center gap-0.5 text-[#f0b56b]" title={t("overlay.locUnknownHint")}>
                  <HelpCircle className="h-3.5 w-3.5" />
                </span>
              ) : null}
            </div>
          )}

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

        <OverlayHudBody
          settings={settings}
          tab={tab}
          setTab={setTab}
          steps={steps}
          activeIndex={activeIndex}
          refuelIndex={refuelIndex}
          location={location}
          shipName={route?.shipName}
          totalProfit={totalProfit}
          hasProfit={hasProfit}
          now={now}
          visible={visible}
          t={t}
        />
      </div>
    </div>
  );
}
