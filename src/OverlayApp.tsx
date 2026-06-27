import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { MapPin, X, Shield, ScrollText } from "lucide-react";
import {
  buildInsuranceRow,
  sortByUrgency,
  type InsuranceShip,
  type UiStatus,
} from "./lib/insurance";

/* ──────────────────────────────────────────────────────────────────────────
 * Overlay en jeu (Phase 2) — HUD sobre affiché par-dessus Star Citizen (F6).
 * Fenêtre transparente, always-on-top, sans vol de focus. Contenu 100 % lecture :
 * lieu détecté (Game.log), assurances à échéance, et activité récente.
 * Rendu par main.tsx quand le label de fenêtre est « overlay ».
 * ────────────────────────────────────────────────────────────────────────── */

type GameLogEvent = { id: number; summary: string; occurredAt: string | null };

const INS_COLOR: Record<UiStatus, string> = {
  ACTIVE: "#34d399",
  WARNING: "#fbbf24",
  EXPIRED: "#f87171",
};

export default function OverlayApp() {
  const { t } = useTranslation();
  const [location, setLocation] = useState<string | null>(null);
  const [insurance, setInsurance] = useState<InsuranceShip[]>([]);
  const [events, setEvents] = useState<GameLogEvent[]>([]);

  // Fond transparent : on neutralise le fond global du bundle pour ce HUD.
  useEffect(() => {
    const prev = document.body.style.background;
    document.body.style.background = "transparent";
    return () => {
      document.body.style.background = prev;
    };
  }, []);

  const loadAll = useCallback(async () => {
    const loc = await invoke<string | null>("get_current_location").catch(() => null);
    setLocation(loc);
    const acc = await invoke<string | null>("get_active_account_id").catch(() => null);
    if (acc) {
      const ins = await invoke<InsuranceShip[]>("get_insurance_ships", { accountId: acc }).catch(
        () => [] as InsuranceShip[],
      );
      setInsurance(ins);
    }
    const ev = await invoke<GameLogEvent[]>("get_recent_gamelog_events", {
      limit: 5,
      kinds: [],
    }).catch(() => [] as GameLogEvent[]);
    setEvents(ev);
  }, []);

  useEffect(() => {
    void loadAll();
    const pLoc = listen<{ location: string }>("gamelog:location", (e) =>
      setLocation(e.payload?.location ?? null),
    );
    const pEv = listen("gamelog:event", () => void loadAll());
    return () => {
      void pLoc.then((un) => un());
      void pEv.then((un) => un());
    };
  }, [loadAll]);

  const insRows = sortByUrgency(insurance.map(buildInsuranceRow)).slice(0, 3);

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

          {/* Assurances à échéance */}
          <section>
            <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/40">
              <Shield className="h-3 w-3" /> {t("overlay.insurance")}
            </div>
            {insRows.length === 0 ? (
              <div className="text-[11px] text-white/35">{t("overlay.insuranceNone")}</div>
            ) : (
              <div className="space-y-1">
                {insRows.map((r) => {
                  const color = r.lti ? INS_COLOR.ACTIVE : INS_COLOR[r.status];
                  const label = r.lti
                    ? "LTI"
                    : r.daysLeft != null
                      ? `${r.daysLeft}j`
                      : r.expiryLabel;
                  return (
                    <div key={r.shipId} className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-[12px] text-white/80">{r.name}</span>
                      <span className="shrink-0 text-[11px] font-semibold" style={{ color }}>
                        {label}
                      </span>
                    </div>
                  );
                })}
              </div>
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
