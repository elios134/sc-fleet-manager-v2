import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { MapPin, Route } from "lucide-react";
import { placeLabel } from "../../../lib/gameLocation";
import { safeName, type StarmapBodyItem } from "../../../components/starmap3d/starmapData";
import { appendItineraryStop } from "../../../components/starmap3d/useItinerary";
import { vuLe } from "../aggregate";
import type { WhereIs } from "../hooks/useWhereIs";
import { SystemMiniMap } from "./SystemMiniMap";

const btn = "flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-[12.5px] font-semibold disabled:opacity-45";

/** Fiche d'un objet trouvé : ses lieux (quantité, dernière lecture), mini-carte du système et
 *  actions vers la carte (voir le lieu, l'ajouter à l'itinéraire). */
export function ItemWhereCard({ w, bodies }: { w: WhereIs; bodies: StarmapBodyItem[] }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [added, setAdded] = useState<string | null>(null);
  const target = w.places.find((p) => p.body)?.body ?? null;
  const marked = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of w.places) if (p.body) m.set(p.body.id, (m.get(p.body.id) ?? 0) + p.qte);
    return m;
  }, [w.places]);
  if (!w.hit) return null;
  const add = (b: StarmapBodyItem) => {
    appendItineraryStop({ bodyId: b.id, poi: null });
    setAdded(b.id);
  };
  return (
    <section className="glass flex flex-col gap-3 rounded-2xl px-4 py-3.5" aria-label={t("inventory.where.places")}>
      <h3 className="truncate text-[17px] font-bold text-white">{w.hit.nom}</h3>
      <ul className="flex flex-col gap-1.5">
        {w.places.map((p) => (
          <li key={p.key} className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.025] px-2.5 py-2">
            <MapPin className="h-4 w-4 shrink-0 text-[var(--accent)]" />
            <span className="min-w-0 flex-1">
              <b className="block truncate text-[12.5px] text-white">{p.key === "MOI" ? t("inventory.onMe") : p.raw ? placeLabel(p.raw) : "—"}</b>
              <small className="text-[10.5px] text-white/40">
                {p.body ? safeName(p.body) : t("inventory.where.offMap")} · {t("inventory.where.seen", { date: vuLe(p.vu) })}
              </small>
            </span>
            <span className="font-mono text-[12px] text-white/75">×{p.qte}</span>
          </li>
        ))}
      </ul>
      {target && <SystemMiniMap bodies={bodies} systemId={target.systemName} marked={marked} />}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!target}
          onClick={() => target && navigate("/starmap", { state: { select: target.id } })}
          className={`${btn} bg-[var(--accent)] text-white hover:brightness-110`}
        >
          <MapPin className="h-4 w-4" />
          {t("inventory.where.showOnMap")}
        </button>
        <button type="button" disabled={!target} onClick={() => target && add(target)} className={`${btn} border border-white/15 bg-white/5 text-white hover:bg-white/10`}>
          <Route className="h-4 w-4" />
          {added === target?.id ? t("inventory.where.added") : t("inventory.where.addToRoute")}
        </button>
      </div>
    </section>
  );
}
