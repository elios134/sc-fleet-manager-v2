import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { Loader2 } from "lucide-react";
import { parseGeo, safeName, type StarmapBodyItem, type GeoData } from "../components/starmap3d/starmapData";
import { bodyKey } from "../components/starmap3d/naming";
import { useLocationData } from "../components/starmap3d/useLocationData";
import { InfoPanel } from "../components/starmap3d/ui/InfoPanel";
import { useStarmapView } from "../components/starmap3d/useStarmapView";
import { systemSummaries } from "../components/starmap3d/panel";
import { crumbsOf, type LayerKey } from "../components/starmap3d/view";
import { SystemRail } from "../components/starmap3d/ui/SystemRail";
import { TopBar } from "../components/starmap3d/ui/TopBar";

// Vue 3D (three.js ~900 Ko) chargée à la demande : le chunk ne se télécharge qu'à
// l'ouverture de la carte, pas au démarrage de l'app.
const Starmap3D = lazy(() => import("../components/starmap3d/Starmap3D"));

const SYSTEM_LAYERS: LayerKey[] = ["stations", "jumps", "belts", "moons"];
const GLOBE_LAYERS: LayerKey[] = ["poi", "stations"];

/* Onglet Carte plein cadre : scène 3D en fond, rail des lieux à gauche, fil d'Ariane et
   calques en haut, fiche du lieu à droite (panneaux en verre par-dessus la scène). */
export default function StarmapPage() {
  const { t } = useTranslation();
  const [bodies, setBodies] = useState<StarmapBodyItem[]>([]);
  const [geo, setGeo] = useState<GeoData>({ systems: [], bodies: [], pois: [] });
  const [loading, setLoading] = useState(true);
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
  }, []);

  // Système par défaut : le premier résumé (système avec étoile d'abord).
  useEffect(() => {
    if (state.view.level === "system" && !state.view.systemId && systems.length > 0) {
      dispatch({ type: "system", systemId: systems[0].id });
    }
  }, [systems, state.view, dispatch]);

  const systemId = state.view.level === "galaxy" ? "" : state.view.systemId;
  const select = (b: StarmapBodyItem) => {
    dispatch({ type: "select", body: b });
    setQuery("");
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
          <div className="rounded-2xl glass border-dashed border-white/15 p-10 text-center text-white/70">{t("starmap.emptyMap")}</div>
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
          <Starmap3D bodies={bodies} geo={geo} nav={nav} />
        </Suspense>
      </div>

      <div className="absolute bottom-24 left-3 top-3 z-10 flex w-[308px] max-[820px]:relative max-[820px]:inset-auto max-[820px]:h-[320px] max-[820px]:w-auto max-[820px]:shrink-0">
        <SystemRail
          bodies={bodies}
          systems={systems}
          systemId={systemId}
          selectedId={state.selectedId}
          query={query}
          onQuery={setQuery}
          onSystem={(id) => dispatch({ type: "system", systemId: id })}
          onSelect={select}
        />
      </div>

      <div className="absolute left-[332px] right-[372px] top-3 z-10 max-[1100px]:bottom-24 max-[1100px]:top-auto max-[820px]:relative max-[820px]:inset-auto max-[820px]:shrink-0">
        <TopBar
          crumbs={crumbsOf(state, bodies)}
          onCrumb={(level) => dispatch({ type: "crumb", level })}
          layers={nav.layers}
          visibleKeys={state.view.level === "object" ? GLOBE_LAYERS : SYSTEM_LAYERS}
          onToggle={nav.toggleLayer}
        />
      </div>

      <div className="absolute bottom-24 right-3 top-3 z-10 flex w-[348px] flex-col max-[820px]:relative max-[820px]:inset-auto max-[820px]:w-auto max-[820px]:shrink-0">
        <InfoPanel
          body={selected}
          poi={poi}
          bodies={bodies}
          geoBody={geo.bodies.find((g) => bodyKey(g.name) === selKey) ?? null}
          pois={bodyPois}
          data={data}
          globe={state.view.level === "object"}
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
        />
      </div>

      <p className="pointer-events-none absolute bottom-24 left-[332px] z-10 max-w-[420px] text-[10.5px] text-white/30 max-[1100px]:hidden">
        {t("starmap.attribution")}
      </p>
    </div>
  );
}
