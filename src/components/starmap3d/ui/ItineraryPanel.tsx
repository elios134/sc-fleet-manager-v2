import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { appLocale } from "../../../lib/format";
import { safeName, type GeoData, type StarmapBodyItem } from "../starmapData";
import { fuelLegs, legOf, optimizeOrder, stopPoint, type FuelState, type ItineraryStop } from "../itinerary";
import type { Itinerary } from "../useItinerary";
import { FactGrid } from "./FactGrid";

export type RangedShip = { name: string; quantumRangeGm: number | null };

const gmFmt = (n: number | null) => (n == null ? "—" : `${n.toLocaleString(appLocale(), { maximumFractionDigits: 1 })} Gm`);
const FUEL_CHIP: Record<Exclude<FuelState, null>, string> = {
  ok: "border-emerald-400/35 bg-emerald-400/15 text-emerald-300",
  refuel: "border-[var(--amber)]/40 bg-[var(--amber-muted)] text-amber-300",
  tooFar: "border-red-400/40 bg-red-400/15 text-red-300",
};
const KIND: Record<string, string> = { Star: "star", Planet: "planet", Moon: "moon", Station: "station", AsteroidBelt: "belt", Jumppoint: "jump" };
const btn = "rounded-[10px] border border-white/15 bg-white/5 px-2.5 py-1.5 text-[12px] font-semibold text-white enabled:hover:bg-white/10 disabled:opacity-40";

/** Onglet Itinéraire : étapes numérotées, distance de chaque étape (points de saut compris),
 *  carburant quantique selon le vaisseau choisi, ordre optimisable. */
export function ItineraryPanel({
  it,
  bodies,
  geo,
  ships,
  here,
  onPick,
}: {
  it: Itinerary;
  bodies: StarmapBodyItem[];
  geo: GeoData;
  ships: RangedShip[];
  /** Corps où se trouve le joueur (Game.log) : départ proposé. */
  here: StarmapBodyItem | null;
  onPick: (stop: ItineraryStop) => void;
}) {
  const { t } = useTranslation();
  const points = useMemo(() => it.stops.map((s) => stopPoint(s, bodies, geo)), [it.stops, bodies, geo]);
  const legs = useMemo(() => points.slice(1).map((p, i) => legOf(points[i], p, geo)), [points, geo]);
  const range = ships.find((s) => s.name === it.ship)?.quantumRangeGm ?? null;
  const fuel = fuelLegs(legs.map((l) => l.gm), range);
  const known = legs.filter((l) => l.gm != null);
  const total = known.length ? known.reduce((a, l) => a + (l.gm ?? 0), 0) : null;
  const jumps = legs.filter((l) => l.jump).length;
  // Étapes sans distance connue : le total n'est qu'un minimum.
  const totalLabel = total != null && known.length < legs.length ? `≥ ${gmFmt(total)}` : gmFmt(total);
  const label = (s: ItineraryStop) => {
    const b = bodies.find((x) => x.id === s.bodyId);
    const kind = b ? KIND[b.navIcon] : undefined;
    return { name: s.poi ?? (b ? safeName(b) : "?"), sub: b ? (s.poi ? safeName(b) : kind ? t(`starmap.kind.${kind}`) : b.navIcon) : "" };
  };
  const optimize = () => {
    const idx = it.stops.map((_, i) => i);
    const order = optimizeOrder(idx, (a, b) => legOf(points[a], points[b], geo).gm);
    it.replace(order.map((i) => it.stops[i]));
  };
  const first = it.stops[0] ? label(it.stops[0]).name : null;
  const last = it.stops.length > 1 ? label(it.stops[it.stops.length - 1]).name : null;

  return (
    <aside className="glass flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl" aria-label={t("starmap.itinerary.title")}>
      <header className="border-b border-white/10 bg-[linear-gradient(135deg,rgba(99,102,241,0.22),transparent_65%)] px-[18px] pb-3 pt-4">
        <p className="text-[10.5px] font-extrabold uppercase tracking-[0.14em] text-white/45">{t("starmap.itinerary.title")}</p>
        <h2 className="mt-1 truncate text-[22px] font-extrabold leading-tight tracking-tight text-white">
          {first ? (last ? `${first} → ${last}` : first) : t("starmap.itinerary.emptyTitle")}
        </h2>
        {it.stops.length > 1 && (
          <div className="mt-3">
            <FactGrid
              facts={[
                [t("starmap.itinerary.stops"), String(it.stops.length)],
                [t("starmap.itinerary.distance"), totalLabel],
                [t("starmap.itinerary.jumps"), String(jumps)],
              ]}
            />
          </div>
        )}
        <label className="mt-3 flex items-center gap-2 text-[12px] text-white/55">
          {t("starmap.itinerary.ship")}
          <select
            value={it.ship ?? ""}
            onChange={(e) => it.setShip(e.target.value || null)}
            className="min-w-0 flex-1 rounded-[9px] border border-white/10 bg-white/5 px-2 py-1.5 text-[12px] font-semibold text-white"
          >
            <option value="">{t("starmap.itinerary.noShip")}</option>
            {ships.map((s) => (
              <option key={s.name} value={s.name} disabled={s.quantumRangeGm == null}>
                {s.quantumRangeGm != null ? t("starmap.itinerary.shipRange", { name: s.name, range: gmFmt(s.quantumRangeGm) }) : s.name}
              </option>
            ))}
          </select>
        </label>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3.5 py-3 [scrollbar-width:thin]">
        {it.stops.length === 0 ? (
          <p className="rounded-xl border border-dashed border-white/15 p-3 text-[12px] text-white/45">{t("starmap.itinerary.emptyHint")}</p>
        ) : (
          it.stops.map((s, i) => {
            const l = label(s);
            const leg = i > 0 ? legs[i - 1] : null;
            const f = i > 0 ? fuel[i - 1] : null;
            return (
              <div key={`${s.bodyId}-${s.poi}-${i}`}>
                {leg && (
                  <p className="ml-5 flex flex-wrap items-center gap-2 border-l-2 border-dashed border-[var(--accent)]/45 py-1.5 pl-4 font-mono text-[11.5px] text-white/60">
                    {gmFmt(leg.gm)}
                    {leg.jump && (
                      <span className="rounded-full border border-[var(--rival)]/35 bg-[var(--rival)]/15 px-2 font-sans text-[10px] font-bold text-orange-300">
                        {t("starmap.itinerary.via", { jump: leg.jump })}
                      </span>
                    )}
                    {f && <span className={`rounded-full border px-2 font-sans text-[10px] font-bold ${FUEL_CHIP[f]}`}>{t(`starmap.itinerary.fuel.${f}`)}</span>}
                  </p>
                )}
                <div className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.025] px-2.5 py-2">
                  <span
                    className={`grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full font-mono text-[11px] font-bold ${
                      i === 0 ? "bg-emerald-400 text-emerald-950" : "bg-[var(--accent)] text-white"
                    }`}
                  >
                    {i === 0 ? "D" : i}
                  </span>
                  <button type="button" onClick={() => it.stops[i] && onPick(it.stops[i])} className="min-w-0 flex-1 text-left">
                    <b className="block truncate text-[13px] text-white">{l.name}</b>
                    <small className="text-[11px] text-white/35">{l.sub}</small>
                  </button>
                  <span className="flex gap-0.5 text-white/40">
                    <button type="button" disabled={i === 0} onClick={() => it.move(i, -1)} aria-label={t("starmap.itinerary.up")} className="rounded p-1 enabled:hover:bg-white/10 enabled:hover:text-white disabled:opacity-30">
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" disabled={i === it.stops.length - 1} onClick={() => it.move(i, 1)} aria-label={t("starmap.itinerary.down")} className="rounded p-1 enabled:hover:bg-white/10 enabled:hover:text-white disabled:opacity-30">
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" onClick={() => it.remove(i)} aria-label={t("starmap.itinerary.remove")} className="rounded p-1 hover:bg-white/10 hover:text-white">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                </div>
              </div>
            );
          })
        )}
        {here && !(it.stops[0]?.bodyId === here.id && !it.stops[0]?.poi) && (
          <button type="button" onClick={() => it.start({ bodyId: here.id, poi: null })} className={`${btn} mt-3 self-start`}>
            {t("starmap.itinerary.fromHere", { place: safeName(here) })}
          </button>
        )}
        {range != null && total != null && (
          <div className="mt-3 px-0.5">
            <p className="mb-1.5 flex justify-between text-[11px] text-white/40">
              <span>{t("starmap.itinerary.fuelRange", { range: gmFmt(range) })}</span>
              <span className="font-mono">{totalLabel}</span>
            </p>
            <div className="flex h-[7px] overflow-hidden rounded-full bg-white/[0.07]">
              <i className="block h-full bg-[var(--accent)]" style={{ width: `${Math.min(100, (Math.min(total, range) / Math.max(total, range)) * 100)}%` }} />
              {total > range && <i className="block h-full bg-[var(--amber)]" style={{ width: `${((total - range) / total) * 100}%` }} />}
            </div>
          </div>
        )}
      </div>

      <footer className="flex gap-1.5 border-t border-white/10 px-3.5 py-3">
        <button type="button" className={btn} disabled={it.stops.length < 3} onClick={optimize}>
          {t("starmap.itinerary.optimize")}
        </button>
        <button type="button" className={btn} disabled={it.stops.length < 2} onClick={it.reverse}>
          {t("starmap.itinerary.reverse")}
        </button>
        <button type="button" className={`${btn} ml-auto`} disabled={it.stops.length === 0} onClick={it.clear}>
          {t("starmap.itinerary.clear")}
        </button>
      </footer>
    </aside>
  );
}
