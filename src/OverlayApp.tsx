import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { MapPin, X, Navigation, ScrollText, ArrowRight } from "lucide-react";

/* ──────────────────────────────────────────────────────────────────────────
 * Overlay en jeu (Phase 2) — HUD sobre affiché par-dessus Star Citizen (F6).
 * Fenêtre transparente, always-on-top, sans vol de focus. Contenu 100 % lecture :
 * lieu détecté (Game.log) + DESTINATION du GPS de trading + activité récente.
 *
 * L'état du GPS vit en sessionStorage de la fenêtre principale (non partagé) :
 * CargoRoutesPage le pousse dans AppMeta « overlay.nav » et émet « overlay:nav ».
 * Rendu par main.tsx quand le label de fenêtre est « overlay ».
 * ────────────────────────────────────────────────────────────────────────── */

type GameLogEvent = { id: number; summary: string; occurredAt: string | null };
type NavInfo = {
  commodity?: string;
  from?: string;
  to?: string;
  profit?: number;
  shipName?: string;
} | null;

function fmtAuec(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export default function OverlayApp() {
  const { t } = useTranslation();
  const [location, setLocation] = useState<string | null>(null);
  const [nav, setNav] = useState<NavInfo>(null);
  const [events, setEvents] = useState<GameLogEvent[]>([]);

  // Fond transparent : on neutralise le fond global du bundle pour ce HUD.
  useEffect(() => {
    const prev = document.body.style.background;
    document.body.style.background = "transparent";
    return () => {
      document.body.style.background = prev;
    };
  }, []);

  const parseNav = (raw: string | null): NavInfo => {
    if (!raw) return null;
    try {
      return JSON.parse(raw) as NavInfo;
    } catch {
      return null;
    }
  };

  const loadAll = useCallback(async () => {
    const [loc, navRaw, ev] = await Promise.all([
      invoke<string | null>("get_current_location").catch(() => null),
      invoke<string | null>("get_app_meta", { key: "overlay.nav" }).catch(() => null),
      invoke<GameLogEvent[]>("get_recent_gamelog_events", { limit: 5, kinds: [] }).catch(
        () => [] as GameLogEvent[],
      ),
    ]);
    setLocation(loc);
    setNav(parseNav(navRaw));
    setEvents(ev);
  }, []);

  useEffect(() => {
    void loadAll();
    const pLoc = listen<{ location: string }>("gamelog:location", (e) =>
      setLocation(e.payload?.location ?? null),
    );
    const pNav = listen<NavInfo>("overlay:nav", (e) => setNav(e.payload ?? null));
    const pEv = listen("gamelog:event", () => void loadAll());
    return () => {
      void pLoc.then((un) => un());
      void pNav.then((un) => un());
      void pEv.then((un) => un());
    };
  }, [loadAll]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden p-1.5 text-white">
      <div className="flex h-full flex-col overflow-hidden rounded-xl border border-white/15 bg-[#0a0a0f]/80 backdrop-blur-md">
        {/* En-tête = poignée de déplacement (data-tauri-drag-region) */}
        <div
          data-tauri-drag-region
          className="flex cursor-move select-none items-center justify-between border-b border-white/10 px-3 py-2"
        >
          <span className="text-xs font-bold uppercase tracking-wider text-[var(--accent)]">
            {t("overlay.title")}
          </span>
          <button
            onClick={() => void invoke("hide_overlay").catch(() => {})}
            className="flex h-5 w-5 items-center justify-center rounded text-white/50 hover:bg-white/10 hover:text-white"
            aria-label={t("overlay.close")}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-auto p-3">
          {/* Lieu courant */}
          <section>
            <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/40">
              <MapPin className="h-3 w-3" /> {t("overlay.location")}
            </div>
            <div className="truncate text-sm font-semibold text-white">
              {location ?? t("overlay.noLocation")}
            </div>
          </section>

          {/* Destination GPS de trading */}
          <section>
            <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/40">
              <Navigation className="h-3 w-3" /> {t("overlay.gps")}
            </div>
            {nav && nav.to ? (
              <div className="rounded-lg border border-[var(--accent)]/30 bg-[var(--accent)]/[0.06] p-2">
                <div className="flex items-center gap-1.5 text-sm font-semibold text-white">
                  {nav.from && (
                    <>
                      <span className="min-w-0 truncate text-white/60">{nav.from}</span>
                      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]" />
                    </>
                  )}
                  <span className="min-w-0 truncate">{nav.to}</span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2 text-[11px]">
                  <span className="min-w-0 truncate text-white/55">{nav.commodity ?? "—"}</span>
                  {nav.profit != null && (
                    <span className="shrink-0 font-semibold text-[#5dcaa5]">
                      +{fmtAuec(nav.profit)} aUEC
                    </span>
                  )}
                </div>
                {nav.shipName && (
                  <div className="mt-0.5 truncate text-[10px] text-white/30">{nav.shipName}</div>
                )}
              </div>
            ) : (
              <div className="text-[11px] text-white/35">{t("overlay.noNav")}</div>
            )}
          </section>

          {/* Activité récente */}
          <section>
            <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/40">
              <ScrollText className="h-3 w-3" /> {t("overlay.activity")}
            </div>
            {events.length === 0 ? (
              <div className="text-[11px] text-white/35">{t("overlay.activityNone")}</div>
            ) : (
              <div className="space-y-1">
                {events.map((e) => (
                  <div key={e.id} className="truncate text-[11px] text-white/65">
                    {e.summary}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="border-t border-white/10 px-3 py-1.5 text-center text-[10px] text-white/30">
          {t("overlay.hint")}
        </div>
      </div>
    </div>
  );
}
