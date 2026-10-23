import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router";
import { Loader2, Map as MapIcon } from "lucide-react";
import { EmptyState } from "../components/ui/EmptyState";
import { parseGeo, safeName, type StarmapBodyItem, type GeoData } from "../components/starmap3d/starmapData";
import { bodyKey } from "../components/starmap3d/naming";
import { useLocationData } from "../components/starmap3d/useLocationData";
import { InfoPanel } from "../components/starmap3d/ui/InfoPanel";
import { useStarmapView } from "../components/starmap3d/useStarmapView";
import { bodyJoinKey, parentJoinKey, positionBody, systemSummaries } from "../components/starmap3d/panel";
import { placeLabel } from "../lib/gameLocation";
import { crumbsOf, type LayerKey } from "../components/starmap3d/view";
import { SystemRail } from "../components/starmap3d/ui/SystemRail";
import { TopBar } from "../components/starmap3d/ui/TopBar";
import { PoiLegend } from "../components/starmap3d/ui/PoiLegend";
import { ItineraryPanel, type RangedShip } from "../components/starmap3d/ui/ItineraryPanel";
import { useItinerary } from "../components/starmap3d/useItinerary";
import { usePlayerZone } from "../components/starmap3d/usePlayerZone";
import type { ItineraryStop } from "../components/starmap3d/itinerary";

// Vue 3D (three.js ~900 Ko) chargée à la demande : le chunk ne se télécharge qu'à
// l'ouverture de la carte, pas au démarrage de l'app.
const Starmap3D = lazy(() => import("../components/starmap3d/Starmap3D"));

const SYSTEM_LAYERS: LayerKey[] = ["stations", "jumps", "belts", "moons", "light"];
const GLOBE_LAYERS: LayerKey[] = ["poi", "stations", "light"];

/* Onglet Carte plein cadre : scène 3D en fond, rail des lieux à gauche, fil d'Ariane et
   calques en haut, fiche du lieu à droite (panneaux en verre par-dessus la scène). */
export default function StarmapPage() {
  const { t } = useTranslation();
  const [bodies, setBodies] = useState<StarmapBodyItem[]>([]);
  const [geo, setGeo] = useState<GeoData>({ systems: [], bodies: [], pois: [] });
  const [loading, setLoading] = useState(true);
  // Synchro de la carte lancée depuis l'état vide → rechargement des corps.
  const [reloadNonce, setReloadNonce] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const systems = useMemo(() => systemSummaries(bodies), [bodies]);
  const nav = useStarmapView("");
  const { state, dispatch } = nav;
  const navigate = useNavigate();
  const selected = useMemo(() => bodies.find((b) => b.id === state.selectedId) ?? null, [bodies, state.selectedId]);
  const selKey = selected ? bodyKey(safeName(selected)) : "";
  const bodyPois = useMemo(() => (selKey ? geo.pois.filter((p) => bodyKey(p.parentBody) === selKey) : []), [geo, selKey]);
  const poi = state.poi ? bodyPois.find((p) => p.name === state.poi) ?? null : null;
  const data = useLocationData(selected, bodies);
  // Itinéraire multi-étapes : onglet du panneau de droite + tracé sur la carte.
  const it = useItinerary();
  // Ouverte depuis un autre onglet avec un itinéraire tout prêt (liste d'achats…) → onglet Itinéraire.
  const opened = useLocation().state as { panel?: "route"; select?: string } | null;
  const [panelTab, setPanelTab] = useState<"info" | "route">(opened?.panel === "route" ? "route" : "info");
  const [ships, setShips] = useState<RangedShip[]>([]);
  useEffect(() => {
    invoke<RangedShip[]>("get_cargo_fleet_ships")
      .then((s) => setShips(s.map((x) => ({ name: x.name, quantumRangeGm: x.quantumRangeGm ?? null }))))
      .catch(() => {});
  }, []);
  const route = useMemo(() => it.stops.map((s, i) => ({ bodyId: s.bodyId, label: i === 0 ? "D" : String(i) })), [it.stops]);
  const stopLabels = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of route) m.set(r.bodyId, m.has(r.bodyId) ? `${m.get(r.bodyId)},${r.label}` : r.label);
    return m;
  }, [route]);
  // Position du joueur : dernier lieu du Game.log (écran de chargement, inventaire ouvert).
  const zone = usePlayerZone();
  const here = useMemo(() => positionBody(zone, bodies), [zone, bodies]);

  useEffect(() => {
    let cancelled = false;
    invoke<StarmapBodyItem[]>("get_starmap_bodies")
      .then((data) => {
        if (!cancelled) setBodies(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    // Géométrie + POI (CDN, repli cache hors-ligne). Échec → géométrie vide : la carte
    // reste montée sur les données RSI (get_starmap_bodies) + rendu procédural.
    invoke<unknown>("starmap_geometry")
      .then((raw) => {
        if (!cancelled) setGeo(parseGeo(raw));
      })
      .catch(() => {
        /* hors-ligne sans cache : on garde la géométrie vide */
      });
    return () => {
      cancelled = true;
    };
  }, [reloadNonce]);

  // Système par défaut : le premier résumé (système avec étoile d'abord).
  useEffect(() => {
    if (state.view.level === "system" && !state.view.systemId && systems.length > 0) {
      dispatch({ type: "system", systemId: systems[0].id });
    }
  }, [systems, state.view, dispatch]);

  // Ouverte depuis un autre onglet sur un lieu précis (inventaire…) → ce corps est sélectionné.
  const toSelect = useRef(opened?.select ?? null);
  useEffect(() => {
    const body = toSelect.current ? bodies.find((b) => b.id === toSelect.current) : undefined;
    if (!body) return;
    toSelect.current = null;
    dispatch({ type: "select", body });
  }, [bodies, dispatch]);

  const systemId = state.view.level === "galaxy" ? "" : state.view.systemId;
  // Vue galaxie : le rail garde le dernier système consulté (sinon il serait vide).
  const lastSystem = useRef("");
  if (systemId) lastSystem.current = systemId;
  const railSystem = systemId || lastSystem.current || systems[0]?.id || "";
  const select = (b: StarmapBodyItem) => {
    const focus = state.view.level === "object" ? state.view.bodyId : null;
    const focusBody = focus ? bodies.find((x) => x.id === focus) : undefined;
    dispatch({ type: "select", body: b, childOfFocus: !!focusBody && parentJoinKey(b) === bodyJoinKey(focusBody) });
    setQuery("");
  };

  // Étape correspondant à ce qui est affiché : le POI ouvert, sinon le corps.
  const currentStop = (b: StarmapBodyItem): ItineraryStop => ({ bodyId: b.id, poi: poi && b.id === selected?.id ? poi.name : null });
  // Clic sur une étape de l'itinéraire : on la montre sur la carte (globe + POI si besoin).
  const pickStop = (s: ItineraryStop) => {
    const b = bodies.find((x) => x.id === s.bodyId);
    if (!b) return;
    if (s.poi) {
      dispatch({ type: "approach", body: b });
      dispatch({ type: "poi", name: s.poi });
    } else {
      select(b);
    }
  };

  if (loading || error || bodies.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        {loading ? (
          <span className="flex items-center gap-2 text-white/50">
            <Loader2 className="h-4 w-4 animate-spin" /> {t("starmap.loadingMap")}
          </span>
        ) : error ? (
          <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
            {t("common.errorPrefix")} {error}
          </p>
        ) : (
          <div className="w-full max-w-xl">
            <EmptyState
              icon={MapIcon}
              title={t("empty.starmap.title")}
              text={t("empty.starmap.text")}
              action={{
                label: t("empty.starmap.action"),
                busy: syncing,
                busyLabel: t("empty.starmap.syncing"),
                onClick: () => {
                  setSyncing(true);
                  void invoke("sync_starmap")
                    .catch(() => {})
                    .finally(() => {
                      setSyncing(false);
                      setReloadNonce((n) => n + 1);
                    });
                },
              }}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative h-full overflow-hidden max-[820px]:flex max-[820px]:flex-col max-[820px]:gap-3 max-[820px]:overflow-y-auto max-[820px]:px-4 max-[820px]:pb-28 max-[820px]:pt-3">
      <div className="absolute inset-0 max-[820px]:relative max-[820px]:h-[56vh] max-[820px]:shrink-0 max-[820px]:overflow-hidden max-[820px]:rounded-2xl">
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center gap-2 text-white/50">
              <Loader2 className="h-4 w-4 animate-spin" /> {t("starmap.loadingMap")}
            </div>
          }
        >
          {/* Monté une fois le système choisi : évite un premier montage « sans système » aussitôt remplacé. */}
          {(state.view.level === "galaxy" || systemId) && <Starmap3D bodies={bodies} geo={geo} nav={nav} hereId={here?.id ?? null} route={route} />}
        </Suspense>
      </div>

      <div className="absolute bottom-24 left-3 top-3 z-10 flex w-[308px] max-[1100px]:bottom-40 max-[820px]:relative max-[820px]:inset-auto max-[820px]:h-[320px] max-[820px]:w-auto max-[820px]:shrink-0">
        <SystemRail
          bodies={bodies}
          systems={systems}
          systemId={railSystem}
          selectedId={state.selectedId}
          hereId={here?.id ?? null}
          stopLabels={stopLabels}
          query={query}
          onQuery={setQuery}
          onSystem={(id) => dispatch({ type: "system", systemId: id })}
          onSelect={select}
        />
      </div>

      <div className="absolute left-[332px] right-[372px] top-3 z-10 max-[1100px]:bottom-24 max-[1100px]:left-3 max-[1100px]:right-3 max-[1100px]:top-auto max-[820px]:relative max-[820px]:inset-auto max-[820px]:shrink-0">
        <TopBar
          crumbs={crumbsOf(state, bodies)}
          onCrumb={(level) => dispatch({ type: "crumb", level })}
          layers={nav.layers}
          visibleKeys={state.view.level === "object" ? GLOBE_LAYERS : SYSTEM_LAYERS}
          onToggle={nav.toggleLayer}
          hereLabel={here && zone ? [...new Set([placeLabel(zone), safeName(here)])].join(" · ") : null}
          onHere={() => here && select(here)}
        />
      </div>

      <div className="absolute bottom-24 right-3 top-3 z-10 flex w-[348px] flex-col gap-2 max-[1100px]:bottom-40 max-[820px]:relative max-[820px]:inset-auto max-[820px]:w-auto max-[820px]:shrink-0">
        <div className="glass flex shrink-0 gap-1 rounded-2xl p-1" role="tablist">
          {(["info", "route"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={panelTab === k}
              onClick={() => setPanelTab(k)}
              className={`flex-1 rounded-xl py-1.5 text-[12px] font-bold ${panelTab === k ? "bg-[var(--accent-muted)] text-white" : "text-white/45 hover:text-white"}`}
            >
              {k === "info" ? t("starmap.itinerary.tabInfo") : t("starmap.itinerary.tabRoute", { count: it.stops.length })}
            </button>
          ))}
        </div>
        {panelTab === "route" ? (
          <ItineraryPanel it={it} bodies={bodies} geo={geo} ships={ships} here={here} onPick={pickStop} />
        ) : (
        <InfoPanel
          body={selected}
          poi={poi}
          bodies={bodies}
          geoBody={geo.bodies.find((g) => bodyKey(g.name) === selKey) ?? null}
          pois={bodyPois}
          data={data}
          globe={state.view.level === "object"}
          systemId={systemId}
          systems={systems}
          onSystem={(id) => dispatch({ type: "system", systemId: id })}
          onApproach={() => selected && dispatch({ type: "approach", body: selected })}
          onSystemView={() => dispatch({ type: "crumb", level: "system" })}
          onPoi={(name) => {
            if (!selected) return;
            if (state.view.level !== "object") dispatch({ type: "approach", body: selected });
            dispatch({ type: "poi", name });
          }}
          onRoutes={() => {
            const r = data.route;
            navigate("/commerce/cargo", r && data.routeShip ? { state: { route: { shipName: data.routeShip, commodity: r.commodity, fromLocation: r.fromLocation, toLocation: r.toLocation } } } : undefined);
          }}
          onInventory={() => navigate("/inventory")}
          onAddStop={() => selected && it.add(currentStop(selected))}
          onStartHere={() => selected && it.start(currentStop(selected))}
        />
        )}
      </div>

      {state.view.level === "object" && nav.layers.poi && (
        <div className="pointer-events-none absolute bottom-[118px] left-[332px] right-[372px] z-10 flex justify-center max-[1100px]:hidden">
          <PoiLegend pois={bodyPois} />
        </div>
      )}

      <p className="pointer-events-none absolute bottom-24 left-[332px] z-10 max-w-[420px] text-[10.5px] text-white/30 max-[1100px]:hidden">
        {t("starmap.attribution")}
      </p>
    </div>
  );
}
