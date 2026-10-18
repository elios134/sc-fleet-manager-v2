import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { appLocale } from "../../../lib/format";
import { freshness, poiLatLon } from "../panel";
import { poiKind, type PoiKind } from "../poiIcons";
import type { GeoPoi } from "../starmapData";
import type { TerminalTrade } from "../useLocationData";
import type { CargoRoute } from "../../../pages/CargoRoutes/types";

const num = (n: number, digits = 2) => n.toLocaleString(appLocale(), { maximumFractionDigits: digits });

/** Titre de section : libellé + filet, compteur optionnel. */
export function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-2 text-[10.5px] font-extrabold uppercase tracking-[0.1em] text-white/60">
        {title}
        <span className="h-px flex-1 bg-white/10" />
        {count != null && <span className="font-semibold normal-case tracking-normal text-white/30">{count}</span>}
      </h3>
      {children}
    </section>
  );
}

export function TradeSection({ trade }: { trade: TerminalTrade[] }) {
  const { t } = useTranslation();
  const now = new Date();
  return (
    <Section title={t("starmap.panel.trade")}>
      <div className="flex flex-col gap-1.5">
        {trade.map((x) => {
          const f = freshness(x.lastModified, now);
          const rows = [
            ...x.buys.map((l) => ({ c: l.commodity, buy: l.price, sell: null as number | null })),
            ...x.sells.map((l) => ({ c: l.commodity, buy: null as number | null, sell: l.price })),
          ];
          return (
            <div key={x.terminal} className="flex flex-col gap-1.5 rounded-xl border border-white/10 bg-white/[0.025] px-3 py-2">
              <p className="flex items-center gap-2 text-[12.5px] font-bold text-white">
                <span className="min-w-0 flex-1 truncate">{x.terminal}</span>
                {f && (
                  <span
                    className={`shrink-0 rounded-full border px-1.5 text-[10px] font-bold ${
                      f.fresh ? "border-emerald-400/35 bg-emerald-400/15 text-emerald-300" : "border-[var(--amber)]/40 bg-[var(--amber-muted)] text-amber-300"
                    }`}
                  >
                    {t(f.label === "h" ? "starmap.panel.freshH" : "starmap.panel.freshD", { n: f.n })}
                  </span>
                )}
              </p>
              <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-3 gap-y-0.5 text-xs tabular-nums">
                <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-white/30">{t("starmap.panel.commodity")}</span>
                <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-white/30">{t("starmap.panel.buy")}</span>
                <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-white/30">{t("starmap.panel.sell")}</span>
                {rows.map((r, i) => (
                  <span key={`${r.c}-${i}`} className="contents">
                    <span className="truncate text-white/75">{r.c}</span>
                    <span className="text-sky-300">{r.buy != null ? num(r.buy) : "—"}</span>
                    <span className="text-emerald-300">{r.sell != null ? num(r.sell) : "—"}</span>
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

export function RouteSection({ route, ship, onOpen }: { route: CargoRoute; ship: string | null; onOpen: () => void }) {
  const { t } = useTranslation();
  return (
    <Section title={t("starmap.panel.bestRoute")}>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-2.5 rounded-xl border border-emerald-400/30 bg-[linear-gradient(90deg,rgba(52,211,153,0.10),transparent)] px-3 py-2 text-left text-[12.5px] hover:brightness-110"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-white">{route.commodity} → {route.toLocation}</span>
          {ship && <small className="block truncate text-[11px] text-white/45">{ship}</small>}
        </span>
        <b className="shrink-0 tabular-nums text-emerald-300">+{num(route.profit, 0)}</b>
      </button>
    </Section>
  );
}

export function InventorySection({ places, onOpen }: { places: { name: string; count: number }[]; onOpen: () => void }) {
  const { t } = useTranslation();
  return (
    <Section title={t("starmap.panel.myInventory")}>
      <div className="flex flex-wrap gap-1.5">
        {places.map((p) => (
          <button key={p.name} type="button" onClick={onOpen} className="rounded-[9px] border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs text-white/80 hover:bg-white/[0.08]">
            {p.name}
            <b className="ml-1.5 tabular-nums text-indigo-200">{p.count}</b>
          </button>
        ))}
      </div>
    </Section>
  );
}

const POI_BADGE: Record<PoiKind, string> = {
  city: "text-indigo-200 bg-[var(--accent-muted)]",
  station: "text-indigo-200 bg-indigo-400/20",
  outpost: "text-sky-300 bg-sky-400/20",
  settlement: "text-sky-200 bg-sky-400/15",
  mining: "text-amber-300 bg-[var(--amber-muted)]",
  comm: "text-violet-300 bg-violet-400/20",
  bunker: "text-red-300 bg-red-400/15",
  cave: "text-stone-300 bg-stone-400/20",
  wreck: "text-orange-300 bg-orange-400/15",
  misc: "text-white/60 bg-white/10",
};

export function SurfaceSection({ pois, onPick }: { pois: GeoPoi[]; onPick: (name: string) => void }) {
  const { t } = useTranslation();
  return (
    <Section title={t("starmap.panel.surface")} count={pois.length}>
      <div className="flex flex-col gap-0.5">
        {pois.map((p) => {
          const k = poiKind(p.type);
          const ll = poiLatLon(p.coord);
          return (
            <button key={p.name} type="button" onClick={() => onPick(p.name)} className="flex items-center gap-2 rounded-lg px-1.5 py-1 text-left text-[12.5px] text-white/85 hover:bg-white/5">
              <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-md text-[10px] font-extrabold ${POI_BADGE[k]}`}>
                {t(`starmap.poiKind.${k}`).charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              {ll && <span className="shrink-0 font-mono text-[10px] text-white/30">{ll.lat}° {ll.lon}°</span>}
            </button>
          );
        })}
      </div>
    </Section>
  );
}
