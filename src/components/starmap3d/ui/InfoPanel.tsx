import { useTranslation } from "react-i18next";
import { appLocale } from "../../../lib/format";
import { SYSTEM_NAMES, safeName, type GeoBody, type GeoPoi, type StarmapBodyItem } from "../starmapData";
import { bodyJoinKey, parentJoinKey, poiLatLon, type TreeKind } from "../panel";
import { poiKind } from "../poiIcons";
import type { LocationData } from "../useLocationData";
import { InventorySection, RouteSection, SurfaceSection, TradeSection } from "./panelSections";

const KIND: Record<string, TreeKind> = {
  Star: "star", Planet: "planet", Moon: "moon", Station: "station", AsteroidBelt: "belt", Jumppoint: "jump",
};
const btn = "rounded-[10px] px-3 py-1.5 text-[12.5px] font-semibold";

/** Fiche du lieu (droite) : en-tête, actions, faits, description, puis commerce, route,
 *  inventaire et POI — chaque section seulement si elle a des données réelles. */
export function InfoPanel({
  body,
  poi,
  bodies,
  geoBody,
  pois,
  data,
  globe,
  onApproach,
  onSystemView,
  onPoi,
  onRoutes,
  onInventory,
}: {
  body: StarmapBodyItem | null;
  poi: GeoPoi | null;
  bodies: StarmapBodyItem[];
  geoBody: GeoBody | null;
  pois: GeoPoi[];
  data: LocationData;
  globe: boolean;
  onApproach: () => void;
  onSystemView: () => void;
  onPoi: (name: string) => void;
  onRoutes: () => void;
  onInventory: () => void;
}) {
  const { t } = useTranslation();
  if (!body) {
    return (
      <aside className="glass flex flex-col gap-1.5 rounded-2xl px-5 py-4">
        <p className="text-[10.5px] font-extrabold uppercase tracking-[0.14em] text-white/45">{t("starmap.panel.empty")}</p>
        <p className="text-sm text-white/60">{t("starmap.panel.emptyHint")}</p>
      </aside>
    );
  }

  const kind = KIND[body.navIcon];
  const system = SYSTEM_NAMES[body.systemName.toLowerCase()] ?? body.systemName.toUpperCase();
  const fmt = (n: number) => Math.round(n).toLocaleString(appLocale());
  const moons = bodies.filter((c) => c.navIcon === "Moon" && parentJoinKey(c) === bodyJoinKey(body)).length;
  const ll = poi ? poiLatLon(poi.coord) : null;
  const facts: [string, string][] = poi
    ? [
        [t("starmap.panel.fact.body"), safeName(body)],
        [t("starmap.panel.fact.type"), t(`starmap.poiKind.${poiKind(poi.type)}`)],
        ...(ll ? [[t("starmap.panel.fact.coords"), `${ll.lat}° ${ll.lon}°`] as [string, string]] : []),
        [t("starmap.panel.fact.quantum"), poi.quantum ? t("starmap.panel.yes") : t("starmap.panel.no")],
      ]
    : [
        [t("starmap.panel.fact.system"), system],
        [t("starmap.panel.fact.type"), kind ? t(`starmap.kind.${kind}`) : body.navIcon],
        ...(body.subtype ? [[t("starmap.panel.fact.subtype"), body.subtype] as [string, string]] : []),
        ...(body.habitable === 1 ? [[t("starmap.panel.fact.habitable"), t("starmap.panel.yes")] as [string, string]] : []),
        ...(geoBody && geoBody.bodyRadius > 0 ? [[t("starmap.panel.fact.radius"), `${fmt(geoBody.bodyRadius)} km`] as [string, string]] : []),
        ...(body.distance != null && body.distance > 0 ? [[t("starmap.panel.fact.distance"), `${body.distance.toLocaleString(appLocale(), { maximumFractionDigits: 2 })} Gm`] as [string, string]] : []),
        ...(moons > 0 ? [[t("starmap.panel.fact.moons"), String(moons)] as [string, string]] : []),
      ];
  const canApproach = kind === "planet" || kind === "moon";

  return (
    <aside className="glass flex min-h-0 flex-col overflow-hidden rounded-2xl" aria-live="polite">
      <header className="border-b border-white/10 bg-[linear-gradient(135deg,rgba(99,102,241,0.22),transparent_65%)] px-[18px] pb-3 pt-4">
        <p className="text-[10.5px] font-extrabold uppercase tracking-[0.14em] text-white/45">
          {poi ? t("starmap.panel.poiOf", { body: safeName(body) }) : `${kind ? t(`starmap.kind.${kind}`) : body.navIcon} · ${system}`}
        </p>
        <h2 className="mt-1 text-[26px] font-extrabold leading-none tracking-tight text-white">{poi ? poi.name : safeName(body)}</h2>
        {(poi || body.subtype) && (
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[12.5px] text-white/55">
            {poi ? poi.type : body.subtype}
            {poi?.hidden && (
              <span className="rounded-full border border-[var(--amber)]/40 bg-[var(--amber)]/10 px-2 py-px text-[10.5px] font-semibold text-[var(--amber)]">
                {t("starmap.panel.hidden")}
              </span>
            )}
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {!globe && canApproach && (
            <button type="button" onClick={onApproach} className={`${btn} bg-[var(--accent)] text-white`}>{t("starmap.panel.approach")}</button>
          )}
          {globe && (
            <button type="button" onClick={onSystemView} className={`${btn} border border-white/15 bg-white/5 text-white`}>{t("starmap.panel.systemView")}</button>
          )}
          <button type="button" onClick={onRoutes} className={`${btn} border border-white/15 bg-white/5 text-white`}>{t("starmap.panel.routesFrom")}</button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-[18px] pb-[18px] pt-3.5 [scrollbar-width:thin]">
        <div className="grid grid-cols-3 gap-1.5">
          {facts.map(([k, v]) => (
            <div key={k} className="min-w-0 rounded-[10px] border border-white/10 bg-white/[0.03] px-2.5 py-1.5">
              <span className="block truncate font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-white/30">{k}</span>
              <b className="mt-0.5 block truncate font-mono text-[12.5px] tabular-nums text-white" title={v}>{v}</b>
            </div>
          ))}
        </div>
        {!poi && body.description && <p className="text-[12.5px] leading-relaxed text-white/60">{body.description}</p>}
        {!poi && data.trade.length > 0 && <TradeSection trade={data.trade} />}
        {!poi && data.route && <RouteSection route={data.route} ship={data.routeShip} onOpen={onRoutes} />}
        {!poi && data.inventory.length > 0 && <InventorySection places={data.inventory} onOpen={onInventory} />}
        {!poi && pois.length > 0 && <SurfaceSection pois={pois} onPick={onPoi} />}
      </div>
    </aside>
  );
}
