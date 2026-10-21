import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { usePersistentState } from "../../../lib/uiPersist";
import { useTranslation } from "react-i18next";
import { type CargoRoute, type GpsLeg, type TradeGraph, type GpsStep, type CargoCtx } from "../types";
import { legToStep, pushOverlayRoute } from "../helpers";

// État et logique du GPS trading (graphe, trajet confirmé, carburant, carrefour courant).
export function useGpsTrip(ctx: CargoCtx) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // Vaisseau · système · flotte · prix viennent du contexte de convoi partagé (barre du haut).
  const { shipName, setShipName, system, setSystem, ships, prices } = ctx;

  const [loadingGraph, setLoadingGraph] = useState(false);
  const [graph, setGraph] = useState<TradeGraph | null>(null);
  const [error, setError] = useState<string | null>(null);

  // État de navigation (100 % front) : départ + étapes confirmées — persisté.
  const [startKey, setStartKey] = usePersistentState<string>("cargo.gps.startKey", "");
  const [paramsOpen, setParamsOpen] = usePersistentState("cargo.gps.paramsOpen", true);
  const [steps, setSteps] = usePersistentState<GpsStep[]>("cargo.gps.steps", []);
  const [expanded, setExpanded] = usePersistentState<string | null>("cargo.gps.expanded", null);
  const [selectedRoute, setSelectedRoute] = usePersistentState<CargoRoute | null>("cargo.gps.route", null);
  const [showMap, setShowMap] = usePersistentState("cargo.gps.showMap", false);

  // Phase 1.2 — lieu détecté en jeu (Game.log) : nourrit le choix du départ.
  const [detectedLocation, setDetectedLocation] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    invoke<string | null>("get_current_location")
      .then((l) => {
        if (alive) setDetectedLocation(l);
      })
      .catch(() => {});
    const pending = listen<{ location: string }>("gamelog:location", (e) => {
      setDetectedLocation(e.payload?.location ?? null);
    });
    return () => {
      alive = false;
      void pending.then((un) => un());
    };
  }, []);

  const hasPrices = (prices?.rows ?? 0) > 0;

  function resetTrip() {
    setStartKey("");
    setSteps([]);
    setExpanded(null);
  }

  async function loadGraph() {
    setError(null);
    setGraph(null);
    resetTrip();
    if (!shipName) {
      setError(t("cargo.err.noShip"));
      return;
    }
    setLoadingGraph(true);
    try {
      const g = await invoke<TradeGraph>("get_trade_graph", {
        shipName,
        system: system || null,
      });
      setGraph(g);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingGraph(false);
    }
  }

  // Restauration : si un trajet GPS a été persisté (vaisseau + départ/étapes), on recharge le
  // graphe au montage SANS réinitialiser le trajet (loadGraph normal appelle resetTrip).
  // PAS de garde par ref : le double-effet StrictMode laisserait `loadingGraph` bloqué à true
  // (le 1er passage est annulé par `alive`, le 2e sortirait tôt). Le garde `alive` suffit :
  // le dernier passage monté termine le chargement.
  useEffect(() => {
    if (!shipName || (!startKey && steps.length === 0)) return;
    let alive = true;
    setLoadingGraph(true);
    invoke<TradeGraph>("get_trade_graph", { shipName, system: system || null })
      .then((g) => {
        if (alive) setGraph(g);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoadingGraph(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Phase 1.2 — rapproche le lieu détecté (code de zone du Game.log, ex. « Stanton_Hurston »)
  // d'un nœud du graphe par recouvrement de jetons. Best-effort : null si pas de correspondance.
  const detectedMatch = useMemo(() => {
    if (!detectedLocation || !graph) return null;
    const tokens = (s: string) =>
      s
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 3 && !/^\d+$/.test(w));
    const want = tokens(detectedLocation);
    if (want.length === 0) return null;
    let best: { key: string; name: string; score: number } | null = null;
    for (const l of graph.locations) {
      const hay = tokens(`${l.name} ${l.system ?? ""} ${l.key}`);
      const score = want.filter((w) => hay.some((h) => h.includes(w) || w.includes(h))).length;
      if (score > 0 && (!best || score > best.score)) best = { key: l.key, name: l.name, score };
    }
    return best;
  }, [detectedLocation, graph]);

  // Carrefour courant = dernier lieu d'arrivée, sinon le lieu de départ.
  const current = steps.length > 0 ? steps[steps.length - 1].leg.toKey : startKey;

  // Overlay en jeu : pousse le TRAJET confirmé (les étapes), pas la modale de détails.
  useEffect(() => {
    pushOverlayRoute(
      steps.length > 0
        ? { source: "gps", shipName, rangeGm: graph?.quantumRangeGm ?? null, steps: steps.map((s) => legToStep(s.leg)) }
        : null,
    );
  }, [steps, shipName, graph]);
  const cumulProfit = steps.reduce((a, s) => a + s.leg.profit, 0);
  const allTimed = steps.length > 0 && steps.every((s) => s.leg.timeMinutes != null);
  const cumulTime = allTimed ? steps.reduce((a, s) => a + (s.leg.timeMinutes ?? 0), 0) : null;

  // ── Carburant quantique / autonomie ──
  // L'API Wiki donne l'autonomie pleine charge (Gm) et la capacité réservoir (SCU). On suit la
  // consommation CUMULÉE depuis le départ, SANS ravitaillement intermédiaire : dès que la
  // distance cumulée dépasse l'autonomie, un arrêt ravitaillement est nécessaire à ce point.
  const rangeGm = graph?.quantumRangeGm ?? null;
  const tankScu = graph?.quantumFuelScu ?? null;
  const hasFuelData = rangeGm != null && rangeGm > 0;
  const cumulDist = steps.reduce((a, s) => a + (s.leg.distanceGm ?? 0), 0);
  const cumulFuel = steps.reduce((a, s) => a + (s.leg.fuelScu ?? 0), 0);
  const remainingRange = hasFuelData ? (rangeGm as number) - cumulDist : null; // Gm avant panne
  const overRange = remainingRange != null && remainingRange < 0;
  // 1re étape où la distance cumulée dépasse l'autonomie = là où l'on tombe en panne sèche.
  const refuelAtStep = (() => {
    if (!hasFuelData) return -1;
    let acc = 0;
    for (let i = 0; i < steps.length; i++) {
      acc += steps[i].leg.distanceGm ?? 0;
      if (acc > (rangeGm as number)) return i;
    }
    return -1;
  })();
  // Leg candidat (depuis le carrefour courant) infaisable avec le carburant restant.
  const legUnreachable = (leg: GpsLeg) =>
    hasFuelData && leg.distanceGm != null && (remainingRange as number) < leg.distanceGm;

  function nameOf(key: string): string {
    return graph?.locations.find((l) => l.key === key)?.name ?? key;
  }

  // Fil d'Ariane : départ + chaque lieu d'arrivée confirmé.
  const crumbs: { key: string; name: string }[] = startKey
    ? [
        { key: startKey, name: nameOf(startKey) },
        ...steps.map((s) => ({ key: s.leg.toKey, name: s.leg.toName ?? s.leg.toLocation })),
      ]
    : [];
  const currentName = crumbs.length > 0 ? crumbs[crumbs.length - 1].name : "";

  // Marche arrière : clic sur un nœud du fil d'Ariane → tronque à cette position.
  function goToCrumb(idx: number) {
    setSteps((prev) => prev.slice(0, idx));
    setExpanded(null);
  }

  function confirmLeg(leg: GpsLeg) {
    setSteps((prev) => [...prev, { leg }]);
    setExpanded(null);
  }

  // Vue carrefour : denrées achetables ici + leurs reventes (legs groupés par denrée).
  const buyable = (graph && current ? graph.buyableAt[current] : undefined) ?? [];
  const legsHere = (graph && current ? graph.legsFrom[current] : undefined) ?? [];
  const legsByCommodity = useMemo(() => {
    const m = new Map<string, GpsLeg[]>();
    for (const l of legsHere) {
      const arr = m.get(l.commodity);
      if (arr) arr.push(l);
      else m.set(l.commodity, [l]);
    }
    return m;
  }, [legsHere]);

  // Lignes triées : denrées rentables d'abord (par potentiel), puis sans revente, ruptures en fin.
  const rows = useMemo(() => {
    const list = buyable.map((item) => ({ item, options: legsByCommodity.get(item.commodity) ?? [] }));
    const score = (r: (typeof list)[number]) => {
      if (r.item.outOfStock) return -1e15;
      const best = r.options[0];
      if (!best) return -1e14;
      return best.profitPerMinute ?? best.profit;
    };
    return list.sort((a, b) => score(b) - score(a));
  }, [buyable, legsByCommodity]);

  return {
    t,
    navigate,
    shipName,
    setShipName,
    system,
    setSystem,
    ships,
    prices,
    loadingGraph,
    setLoadingGraph,
    graph,
    setGraph,
    error,
    setError,
    startKey,
    setStartKey,
    paramsOpen,
    setParamsOpen,
    steps,
    setSteps,
    expanded,
    setExpanded,
    selectedRoute,
    setSelectedRoute,
    showMap,
    setShowMap,
    detectedLocation,
    setDetectedLocation,
    hasPrices,
    resetTrip,
    loadGraph,
    detectedMatch,
    current,
    cumulProfit,
    allTimed,
    cumulTime,
    rangeGm,
    tankScu,
    hasFuelData,
    cumulDist,
    cumulFuel,
    remainingRange,
    overRange,
    refuelAtStep,
    legUnreachable,
    nameOf,
    crumbs,
    currentName,
    goToCrumb,
    confirmLeg,
    buyable,
    legsHere,
    legsByCommodity,
    rows,
  };
}
export type GpsTrip = ReturnType<typeof useGpsTrip>;
