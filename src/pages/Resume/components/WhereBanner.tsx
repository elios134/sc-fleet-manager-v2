import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { MapPin, Route } from "lucide-react";
import type { StarmapBodyItem } from "../../../components/starmap3d/starmapData";
import { appendItineraryStop } from "../../../components/starmap3d/useItinerary";
import { durationParts } from "../lib/timeline";

/** Bandeau « Où j'en étais » : dernier lieu, système, date et durée de la session ; vers la carte. */
export function WhereBanner({
  place,
  system,
  start,
  durationSeconds,
  handle,
  body,
}: {
  place: string | null;
  system: string | null;
  start: string | null;
  durationSeconds: number;
  handle: string | null;
  body: StarmapBodyItem | null;
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [added, setAdded] = useState(false);
  const d = durationParts(durationSeconds);
  const when = start ? new Date(start).toLocaleDateString(i18n.language, { weekday: "short", day: "numeric", month: "short" }) : null;
  const btn = "inline-flex items-center gap-2 rounded-[11px] px-3.5 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <section className="glass flex flex-wrap items-center justify-between gap-6 rounded-[18px] bg-[linear-gradient(120deg,color-mix(in_oklab,var(--accent)_22%,transparent),transparent_55%)] px-7 py-6">
      <div className="min-w-0">
        <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-white/40">
          {t("resume.where")}
          {handle ? ` · ${handle}` : ""}
        </p>
        <h1 className="mb-0.5 mt-1 text-[32px] font-bold tracking-tight text-white">{place ?? t("resume.unknownPlace")}</h1>
        <p className="text-xs text-white/60">
          {[system, when && t("resume.sessionOf", { date: when }), (d.h || d.m) && t("resume.duration", { h: d.h, m: d.m })].filter(Boolean).join(" · ")}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={!body} onClick={() => body && navigate("/starmap", { state: { select: body.id } })} className={`${btn} bg-[var(--accent)] text-white hover:brightness-110`}>
          <MapPin className="h-4 w-4" /> {t("inventory.where.showOnMap")}
        </button>
        <button
          type="button"
          disabled={!body}
          onClick={() => {
            if (!body) return;
            appendItineraryStop({ bodyId: body.id, poi: null });
            setAdded(true);
          }}
          className={`${btn} border border-white/15 bg-white/[0.06] text-white hover:bg-white/10`}
        >
          <Route className="h-4 w-4" /> {added ? t("inventory.where.added") : t("inventory.where.addToRoute")}
        </button>
      </div>
    </section>
  );
}
