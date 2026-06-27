import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { X, ArrowRight, MapPin, Check, Navigation } from "lucide-react";

/* ──────────────────────────────────────────────────────────────────────────
 * Overlay en jeu (F6) — affiche UNIQUEMENT la route choisie (Planificateur,
 * Boucle ou GPS de trading), étape par étape. L'étape courante est surlignée
 * selon le lieu détecté dans le Game.log (rapprochement par jetons).
 *
 * La route est poussée par CargoRoutesPage dans AppMeta « overlay.nav » +
 * l'event « overlay:nav » (le sessionStorage n'est pas partagé entre fenêtres).
 * ────────────────────────────────────────────────────────────────────────── */

type OverlayStep = { from: string; to: string; commodity?: string; profit?: number };
type OverlayRoute =
  | { source: "single" | "loop" | "gps"; shipName?: string; steps: OverlayStep[] }
  | null;

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !/^\d+$/.test(w));
}
// Recouvrement de jetons entre un lieu détecté (code de zone) et un nom de lieu.
function score(a: string, b: string): number {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.length || !B.length) return 0;
  return A.filter((x) => B.some((y) => x.includes(y) || y.includes(x))).length;
}

function fmtAuec(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export default function OverlayApp() {
  const { t } = useTranslation();
  const [route, setRoute] = useState<OverlayRoute>(null);
  const [location, setLocation] = useState<string | null>(null);

  // Fond transparent pour ce HUD.
  useEffect(() => {
    const prev = document.body.style.background;
    document.body.style.background = "transparent";
    return () => {
      document.body.style.background = prev;
    };
  }, []);

  const parseRoute = (raw: string | null): OverlayRoute => {
    if (!raw) return null;
    try {
      return JSON.parse(raw) as OverlayRoute;
    } catch {
      return null;
    }
  };

  const load = useCallback(async () => {
    const [navRaw, loc] = await Promise.all([
      invoke<string | null>("get_app_meta", { key: "overlay.nav" }).catch(() => null),
      invoke<string | null>("get_current_location").catch(() => null),
    ]);
    setRoute(parseRoute(navRaw));
    setLocation(loc);
  }, []);

  useEffect(() => {
    void load();
    const pNav = listen<OverlayRoute>("overlay:nav", (e) => setRoute(e.payload ?? null));
    const pLoc = listen<{ location: string }>("gamelog:location", (e) =>
      setLocation(e.payload?.location ?? null),
    );
    return () => {
      void pNav.then((un) => un());
      void pLoc.then((un) => un());
    };
  }, [load]);

  // Étape courante = celle dont le DÉPART correspond au lieu détecté ; sinon, si on est
  // arrivé à un lieu (correspond à une ARRIVÉE), l'étape suivante ; sinon la première.
  const activeIndex = useMemo(() => {
    const steps = route?.steps ?? [];
    if (steps.length === 0) return 0;
    if (!location) return 0;
    let best = -1;
    let bestSc = 0;
    steps.forEach((s, i) => {
      const sc = score(location, s.from);
      if (sc > bestSc) {
        bestSc = sc;
        best = i;
      }
    });
    if (best >= 0) return best;
    let bestTo = -1;
    let bestToSc = 0;
    steps.forEach((s, i) => {
      const sc = score(location, s.to);
      if (sc > bestToSc) {
        bestToSc = sc;
        bestTo = i;
      }
    });
    if (bestTo >= 0) return Math.min(bestTo + 1, steps.length - 1);
    return 0;
  }, [route, location]);

  const steps = route?.steps ?? [];

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden p-1.5 text-white">
      <div className="flex h-full flex-col overflow-hidden rounded-xl border border-white/15 bg-[#0a0a0f]/80 backdrop-blur-md">
        {/* En-tête = poignée de déplacement */}
        <div
          data-tauri-drag-region
          className="flex cursor-move select-none items-center justify-between border-b border-white/10 px-3 py-2"
        >
          <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[var(--accent)]">
            <Navigation className="h-3.5 w-3.5" />
            {t("overlay.route")}
          </span>
          <button
            onClick={() => void invoke("hide_overlay").catch(() => {})}
            className="flex h-5 w-5 items-center justify-center rounded text-white/50 hover:bg-white/10 hover:text-white"
            aria-label={t("overlay.close")}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-2.5">
          {steps.length === 0 ? (
            <div className="flex h-full items-center justify-center px-3 text-center text-[11px] text-white/40">
              {t("overlay.noRoute")}
            </div>
          ) : (
            <>
              {route?.shipName && (
                <div className="mb-2 truncate px-1 text-[11px] text-white/35">{route.shipName}</div>
              )}
              <div>
                {steps.map((s, i) => {
                  const done = i < activeIndex;
                  const active = i === activeIndex;
                  const color = active ? "var(--accent)" : done ? "#3f4452" : "#60a5fa";
                  return (
                    <div key={i} className="flex gap-2.5">
                      {/* rail */}
                      <div className="flex w-5 flex-none flex-col items-center">
                        <div
                          className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold"
                          style={{
                            background: active ? "var(--accent)" : `${color}22`,
                            color: active ? "#15110a" : color,
                            border: active ? "none" : `1px solid ${color}55`,
                          }}
                        >
                          {done ? <Check className="h-3 w-3" /> : i + 1}
                        </div>
                        {i < steps.length - 1 && <div className="my-0.5 w-px flex-1 bg-white/12" />}
                      </div>
                      {/* corps */}
                      <div
                        className={`mb-1.5 min-w-0 flex-1 rounded-lg px-2 py-1.5 ${
                          active ? "border border-[var(--accent)]/40 bg-[var(--accent)]/[0.07]" : ""
                        } ${done ? "opacity-45" : ""}`}
                      >
                        <div className="flex items-center gap-1.5 text-[13px] font-semibold">
                          <span className="min-w-0 truncate text-white/70">{s.from}</span>
                          <ArrowRight className="h-3 w-3 flex-none text-[var(--accent)]" />
                          <span className="min-w-0 truncate text-white">{s.to}</span>
                        </div>
                        <div className="mt-0.5 flex items-center justify-between gap-2 text-[11px]">
                          <span className="min-w-0 truncate text-white/55">{s.commodity ?? "—"}</span>
                          {s.profit != null && (
                            <span className="flex-none font-semibold text-[#5dcaa5]">
                              +{fmtAuec(s.profit)}
                            </span>
                          )}
                        </div>
                        {active && location && (
                          <div className="mt-1 flex items-center gap-1 text-[10px] text-[var(--accent)]">
                            <MapPin className="h-3 w-3" /> {t("overlay.youAreHere")}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <div className="border-t border-white/10 px-3 py-1.5 text-center text-[10px] text-white/30">
          {t("overlay.hint")}
        </div>
      </div>
    </div>
  );
}
