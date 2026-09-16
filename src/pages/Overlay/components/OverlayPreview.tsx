import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigation, Clock, Lock, LockOpen, HandMetal, Minimize2, Contrast, X } from "lucide-react";
import type { OverlaySettings } from "../../../lib/overlayPreferences";
import { OverlayHudBody } from "../../../components/overlay/hudParts";
import { SAMPLE_STEPS, SAMPLE_SHIP, SAMPLE_ACTIVE_INDEX, SAMPLE_REFUEL_INDEX, makeSampleTimers } from "../sampleData";

/* Aperçu de l'overlay : le HUD réel (OverlayHudBody) dessiné par-dessus un fond « jeu »
   représentatif, alimenté par des données d'exemple. Reflète les réglages en direct. */

// Fond « jeu » simulé : espace + planète + amorce de cockpit (SVG inline, autonome).
function GameBackdrop() {
  return (
    <>
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 160 100" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="ov-space" cx="30%" cy="20%" r="90%">
            <stop offset="0%" stopColor="#1a2036" /><stop offset="55%" stopColor="#0a0d18" /><stop offset="100%" stopColor="#04050a" />
          </radialGradient>
          <radialGradient id="ov-planet" cx="35%" cy="35%" r="70%">
            <stop offset="0%" stopColor="#c98a5a" /><stop offset="55%" stopColor="#7a4a2e" /><stop offset="100%" stopColor="#2a1710" />
          </radialGradient>
        </defs>
        <rect width="160" height="100" fill="url(#ov-space)" />
        <g fill="#fff">
          <circle cx="18" cy="14" r=".5" opacity=".8" /><circle cx="42" cy="8" r=".4" opacity=".6" /><circle cx="70" cy="22" r=".5" opacity=".7" />
          <circle cx="120" cy="12" r=".4" opacity=".5" /><circle cx="140" cy="30" r=".6" opacity=".8" /><circle cx="95" cy="6" r=".4" opacity=".6" />
          <circle cx="10" cy="46" r=".5" opacity=".6" /><circle cx="55" cy="40" r=".4" opacity=".5" /><circle cx="30" cy="70" r=".5" opacity=".7" />
          <circle cx="150" cy="60" r=".5" opacity=".6" /><circle cx="80" cy="84" r=".4" opacity=".5" />
        </g>
        <circle cx="118" cy="74" r="46" fill="url(#ov-planet)" />
        <ellipse cx="118" cy="74" rx="66" ry="12" fill="none" stroke="#e0b088" strokeWidth=".6" opacity=".35" transform="rotate(-18 118 74)" />
      </svg>
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 160 100" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M0,100 L0,72 Q40,88 80,88 Q120,88 160,72 L160,100 Z" fill="rgba(6,8,14,.85)" />
        <path d="M0,72 Q40,88 80,88 Q120,88 160,72" fill="none" stroke="rgba(99,102,241,.25)" strokeWidth=".6" />
        <g stroke="rgba(120,180,255,.18)" strokeWidth=".4" fill="none">
          <path d="M14,92 h24 M122,92 h24" /><circle cx="80" cy="30" r="10" />
          <path d="M70,30 h-6 M96,30 h-6 M80,20 v-4 M80,44 v-4" />
        </g>
      </svg>
    </>
  );
}

export default function OverlayPreview({ s }: { s: OverlaySettings }) {
  const { t } = useTranslation();
  const sampleTimers = useMemo(() => makeSampleTimers(), []);
  const [now, setNow] = useState(() => Date.now());
  const [tab, setTab] = useState<"route" | "timers">(s.defaultTab);

  // Horloge 1 s pour les décomptes de l'aperçu.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Onglet borné aux panneaux activés (comme la fenêtre réelle).
  useEffect(() => {
    if (tab === "route" && !s.panels.route && s.panels.timers) setTab("timers");
    if (tab === "timers" && !s.panels.timers && s.panels.route) setTab("route");
  }, [s.panels, tab]);

  const isProjection = s.visualStyle === "projection";
  const showRoute = s.panels.route && (tab === "route" || !s.panels.timers);
  const showTimers = s.panels.timers && (tab === "timers" || !s.panels.route);
  const headerIsTimers = showTimers && !showRoute;

  const totalProfit = SAMPLE_STEPS.reduce((a, x) => a + (x.profit ?? 0), 0);
  const hasProfit = SAMPLE_STEPS.some((x) => x.profit != null);
  const glyph = "flex h-5 w-5 items-center justify-center rounded text-white/45";

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10" style={{ aspectRatio: "16 / 10", background: "#05070d" }}>
      {/* Fond « jeu » : vrai screenshot en jeu (public/overlay-ingame.jpg) ; le SVG reste
          en repli si l'image est absente (onError → masque l'img, le SVG dessous prend le relais). */}
      <GameBackdrop />
      <img
        src="/overlay-ingame.jpg"
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
        onError={(e) => {
          e.currentTarget.style.display = "none";
        }}
      />
      <div className="pointer-events-none absolute inset-0" style={{ background: "linear-gradient(180deg,transparent 60%,rgba(0,0,0,.5))" }} />
      <span className="absolute left-2.5 top-2.5 z-10 rounded-md border border-white/10 bg-black/40 px-2 py-1 text-[9.5px] uppercase tracking-wider text-white/55 backdrop-blur">
        {t("overlayPage.stageBadge")}
      </span>

      {/* Le HUD, positionné dans un coin comme en jeu */}
      <div className="absolute right-4 top-4 z-20 w-[288px]" style={{ opacity: s.opacity }}>
        <div className={`flex max-h-[calc(100%-2rem)] flex-col overflow-hidden ${isProjection ? "border border-[var(--accent)]/35 bg-transparent" : "rounded-xl border border-white/15 bg-[#0a0a0f]/85 backdrop-blur-md"} ${isProjection ? "p-1" : ""}`}>
          {/* En-tête représentatif (non interactif dans l'aperçu) */}
          <div className={`flex select-none items-center gap-1 border-b px-2.5 py-1.5 ${isProjection ? "border-[var(--accent)]/25 bg-[var(--accent)]/[0.03]" : "border-white/10"} ${s.locked ? "" : "cursor-move"}`}>
            <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[var(--accent)]">
              {headerIsTimers ? <Clock className="h-3.5 w-3.5" /> : <Navigation className="h-3.5 w-3.5" />}
              {headerIsTimers ? t("overlay.tabTimers") : t("overlay.route")}
            </span>
            <div className="ml-auto flex items-center gap-0.5">
              <span className={glyph}>{s.locked ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}</span>
              <span className={`${glyph} ${s.clickThrough ? "text-[var(--accent)]" : ""}`}><HandMetal className="h-3.5 w-3.5" /></span>
              <span className={glyph}><Minimize2 className="h-3.5 w-3.5" /></span>
              <span className={glyph}><Contrast className="h-3.5 w-3.5" /></span>
              <span className={glyph}><X className="h-3.5 w-3.5" /></span>
            </div>
          </div>

          <OverlayHudBody
            settings={s}
            tab={tab}
            setTab={setTab}
            steps={SAMPLE_STEPS}
            activeIndex={SAMPLE_ACTIVE_INDEX}
            refuelIndex={SAMPLE_REFUEL_INDEX}
            location={SAMPLE_STEPS[SAMPLE_ACTIVE_INDEX]?.from ?? null}
            shipName={SAMPLE_SHIP}
            totalProfit={totalProfit}
            hasProfit={hasProfit}
            now={now}
            visible
            sampleTimers={sampleTimers}
            t={t}
          />
        </div>
      </div>
    </div>
  );
}
