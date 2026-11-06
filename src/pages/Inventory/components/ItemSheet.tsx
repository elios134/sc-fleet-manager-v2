import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { Box, MapPin, Route } from "lucide-react";
import { placeLabel } from "../../../lib/gameLocation";
import { safeName, type StarmapBodyItem } from "../../../components/starmap3d/starmapData";
import { appendItineraryStop } from "../../../components/starmap3d/useItinerary";
import { vuLe, type InvRow } from "../aggregate";
import type { PlacedItem } from "../hooks/useWhereIs";
import { SystemMiniMap } from "./SystemMiniMap";

const btn = "flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-[12.5px] font-semibold disabled:opacity-45";

/** Fiche fixe d'un objet : image, catégorie, tous ses lieux (quantité, dernière lecture), mini-carte
 *  du système et actions vers la carte (voir le lieu, l'ajouter à l'itinéraire). */
export function ItemSheet({ item, places, bodies }: { item: InvRow; places: PlacedItem[]; bodies: StarmapBodyItem[] }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [added, setAdded] = useState<string | null>(null);
  const target = places.find((p) => p.body)?.body ?? null;
  const marked = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of places) if (p.body) m.set(p.body.id, (m.get(p.body.id) ?? 0) + p.qte);
    return m;
  }, [places]);
  const add = (b: StarmapBodyItem) => {
    appendItineraryStop({ bodyId: b.id, poi: null });
    setAdded(b.id);
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        <div className="grid h-40 shrink-0 place-items-center rounded-xl bg-white/[0.03]">
          {item.imageUrl ? <img src={item.imageUrl} alt="" className="max-h-36 max-w-[82%] object-contain" /> : <Box className="h-12 w-12 text-white/30" strokeWidth={1.4} />}
        </div>
        <div>
          <h2 className="text-xl font-bold text-white">{item.nom}</h2>
          <span className="mt-1.5 inline-block rounded-full border border-[var(--accent)]/50 bg-[var(--accent-muted)] px-2 py-0.5 text-[11px] text-white">{item.categorie}</span>
        </div>
        <section aria-label={t("inventory.where.places")}>
          <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-white/40">{t("inventory.where.places")}</p>
          <ul className="flex flex-col gap-1.5">
            {places.map((p) => (
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
        </section>
        {target && <SystemMiniMap bodies={bodies} systemId={target.systemName} marked={marked} />}
      </div>
      <div className="mt-3 flex shrink-0 gap-2 border-t border-white/10 pt-3">
        <button type="button" disabled={!target} onClick={() => target && navigate("/starmap", { state: { select: target.id } })} className={`${btn} bg-[var(--accent)] text-white hover:brightness-110`}>
          <MapPin className="h-4 w-4" /> {t("inventory.where.showOnMap")}
        </button>
        <button type="button" disabled={!target} onClick={() => target && add(target)} className={`${btn} border border-white/15 bg-white/5 text-white hover:bg-white/10`}>
          <Route className="h-4 w-4" /> {added === target?.id ? t("inventory.where.added") : t("inventory.where.addToRoute")}
        </button>
      </div>
    </div>
  );
}
