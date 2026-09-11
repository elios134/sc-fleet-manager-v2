import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { usePersistentState } from "../../../lib/uiPersist";
import { Loader2, PackageSearch, ArrowRight, Truck, Fuel, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { RouteDetailsModal } from "../../../components/RouteDetailsModal";
import { TripMapModal } from "../../../components/TripMapModal";
import Dropdown from "../../../components/ui/Dropdown";
import { type CargoRoute, type GpsLeg, type TradeGraph, type GpsStep, type CargoCtx } from "../types";
import { legToStep, pushOverlayRoute, SYSTEMS, fmt, relativeAge } from "../helpers";
import { AffluenceBadge } from "../components/AffluenceBadge";
import { FuelBadge } from "../components/FuelBadge";
import { Field } from "../components/Field";

function GpsTradingTab({ ctx, onLoadToHold }: {
  ctx: CargoCtx;
  onLoadToHold: (shipName: string, commodity: string, scu: number) => void;
}) {
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

  return (
    <>
      <div className="mb-4 flex justify-end">
        <div className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-[11px] text-white/60">
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: hasPrices ? "rgb(52 211 153)" : "var(--accent)" }}
            aria-hidden="true"
          />
          <span>
            {hasPrices
              ? t("cargo.pricesFresh", { age: relativeAge(prices?.freshestTimestamp ?? null, t) })
              : t("cargo.pricesNone")}
          </span>
        </div>
      </div>

      {error && (
        <p className="mt-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <div className="mt-2 flex flex-col gap-5">
        {/* Paramètres (panneau en haut) : vaisseau + système + chargement du graphe + départ */}
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <button
            type="button"
            onClick={() => setParamsOpen((o) => !o)}
            className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-white/50 transition-colors hover:text-white/70"
          >
            <ChevronDown className={`h-4 w-4 transition-transform ${paramsOpen ? "" : "-rotate-90"}`} aria-hidden="true" />
            {t("cargo.form.title")}
          </button>

          {!paramsOpen ? (
            <p className="text-xs text-white/50">
              {(shipName || "—") + " · " + (system ? system.charAt(0).toUpperCase() + system.slice(1) : t("cargo.form.systemAll"))}
            </p>
          ) : (
          <>
          <p className="mb-4 text-[11px] leading-relaxed text-white/40">{t("cargo.gps.intro")}</p>

          <>
              <div className="grid items-start gap-x-4 gap-y-1 md:grid-cols-2">
              <Field label={t("cargo.form.ship")}>
                <Dropdown
                  value={shipName}
                  onChange={setShipName}
                  ariaLabel={t("cargo.form.ship")}
                  options={ships.map((s) => ({
                    value: s.name,
                    label: `${s.name}${s.cargoScu != null ? ` · ${s.cargoScu} SCU` : ""}`,
                  }))}
                />
              </Field>

              <Field label={t("cargo.form.system")}>
                <Dropdown
                  value={system}
                  onChange={setSystem}
                  ariaLabel={t("cargo.form.system")}
                  options={[
                    { value: "", label: t("cargo.form.systemAll") },
                    ...SYSTEMS.map((s) => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) })),
                  ]}
                />
              </Field>
              </div>

              <button
                type="button"
                onClick={() => void loadGraph()}
                disabled={loadingGraph || !hasPrices || !shipName}
                className="mt-1 flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loadingGraph ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageSearch className="h-4 w-4" />}
                {loadingGraph ? t("cargo.gps.loadingGraph") : t("cargo.gps.loadGraph")}
              </button>

              {graph && (
                <Field label={t("cargo.gps.start")}>
                  <Dropdown
                    value={startKey}
                    onChange={(v) => {
                      setStartKey(v);
                      setSteps([]);
                      setExpanded(null);
                      setParamsOpen(false);
                    }}
                    ariaLabel={t("cargo.gps.start")}
                    searchable
                    placeholder={t("cargo.gps.pickStart")}
                    options={graph.locations.map((l) => ({
                      value: l.key,
                      label: l.system ? `${l.name} · ${l.system}` : l.name,
                    }))}
                  />
                  {detectedLocation && (
                    <div className="mt-1.5 text-xs text-white/50">
                      📍 {t("cargo.gps.detectedLocation", { location: detectedLocation })}
                      {detectedMatch && detectedMatch.key !== startKey && (
                        <button
                          type="button"
                          onClick={() => {
                            setStartKey(detectedMatch.key);
                            setSteps([]);
                            setExpanded(null);
                            setParamsOpen(false);
                          }}
                          className="ml-2 rounded border border-[var(--accent)]/40 px-2 py-0.5 text-[var(--accent)] transition-colors hover:bg-white/5"
                        >
                          {t("cargo.gps.useDetected", { name: detectedMatch.name })}
                        </button>
                      )}
                    </div>
                  )}
                </Field>
              )}

              {!hasPrices && (
                <button
                  type="button"
                  onClick={() => navigate("/settings")}
                  className="mt-3 w-full rounded-lg border border-[var(--accent)]/50 px-3 py-2 text-xs text-[var(--accent)] hover:bg-white/5"
                >
                  {t("cargo.empty.noPricesCta")}
                </button>
              )}
            </>
          </>
          )}
        </div>

        {/* Navigation : trajet + carrefour courant */}
        <div className="flex flex-col gap-5">
          {/* Bandeau « Mon trajet » + breadcrumb */}
          {graph && startKey && (
            <div className="rounded-2xl border border-[var(--accent)]/25 bg-[var(--accent)]/[0.06] p-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-white/60">
                    {t("cargo.gps.myRoute")}
                  </p>
                  {hasFuelData && (
                    <span
                      title={t("cargo.gps.autonomyTitle")}
                      className="inline-flex items-center gap-1 rounded-md border border-sky-400/30 bg-sky-400/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-300"
                    >
                      <Fuel className="h-3 w-3" />
                      {t("cargo.gps.autonomy")} {(rangeGm as number).toFixed(0)} Gm
                      {tankScu != null ? ` · ${t("cargo.gps.tank")} ${tankScu.toFixed(1)} SCU` : ""}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowMap(true)}
                    disabled={steps.length === 0}
                    title={t("cargo.gps.viewMap")}
                    className="rounded-lg border border-white/10 px-2.5 py-1 text-[11px] font-medium text-white/60 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:text-white/25 disabled:hover:bg-transparent"
                  >
                    {t("cargo.gps.viewMap")}
                  </button>
                  <button
                    type="button"
                    onClick={resetTrip}
                    className="rounded-lg border border-white/10 px-2.5 py-1 text-[11px] font-medium text-white/60 hover:bg-white/10"
                  >
                    {t("cargo.gps.reset")}
                  </button>
                </div>
              </div>

              {/* Fil d'Ariane cliquable (marche arrière) */}
              <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
                {crumbs.map((c, i) => (
                  <span key={`${c.key}-${i}`} className="flex items-center gap-1.5">
                    {i > 0 && <ArrowRight className="h-3.5 w-3.5 shrink-0 text-white/30" />}
                    <button
                      type="button"
                      onClick={() => goToCrumb(i)}
                      className={`max-w-[180px] truncate rounded-md px-2 py-0.5 capitalize transition-colors ${
                        i === crumbs.length - 1
                          ? "bg-[var(--accent)]/20 font-semibold text-white"
                          : "text-white/70 hover:bg-white/10"
                      }`}
                    >
                      {i === 0 ? `${t("cargo.gps.startAt")} · ${c.name}` : c.name}
                    </button>
                  </span>
                ))}
              </div>

              {steps.length === 0 ? (
                <p className="mt-3 text-[12px] text-white/50">{t("cargo.gps.emptyTrip")}</p>
              ) : (
                <>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-white/60">
                    <span>
                      {t("cargo.gps.cumulProfit")}{" "}
                      <span className="font-semibold text-emerald-400">+{fmt(cumulProfit)} aUEC</span>
                    </span>
                    <span>
                      {t("cargo.gps.totalTime")}{" "}
                      <span className="text-white/80">
                        {cumulTime != null ? `${cumulTime.toFixed(1)} ${t("cargo.unit.min")}` : "—"}
                      </span>
                    </span>
                    <span>
                      {t("cargo.gps.steps")} <span className="text-white/80">{steps.length}</span>
                    </span>
                  </div>

                  {/* Jauge de carburant : distance cumulée vs autonomie pleine charge */}
                  {hasFuelData && (
                    <div className="mt-3">
                      <div className="mb-1 flex items-center justify-between text-[11px] text-white/60">
                        <span>
                          {t("cargo.gps.fuelUsed")}{" "}
                          <span className={overRange ? "font-semibold text-red-300" : "text-white/80"}>
                            {cumulDist.toFixed(0)}/{(rangeGm as number).toFixed(0)} Gm
                          </span>
                        </span>
                        <span className="text-sky-300">{cumulFuel.toFixed(2)} SCU</span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${Math.min(100, (cumulDist / (rangeGm as number)) * 100)}%`,
                            background: overRange ? "rgb(248 113 113)" : "rgb(56 189 248)",
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {refuelAtStep >= 0 && (
                    <div className="mt-2 flex items-center gap-2 rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-1.5 text-[11px] text-red-300">
                      <Fuel className="h-3.5 w-3.5 shrink-0" />
                      {t("cargo.gps.refuelWarning", { n: refuelAtStep + 1 })}
                    </div>
                  )}

                  <div className="mt-3 flex flex-col gap-2">
                    {steps.map((s, i) => (
                      <div
                        key={i}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedRoute(s.leg)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setSelectedRoute(s.leg);
                          }
                        }}
                        className="cursor-pointer rounded-lg border border-white/10 bg-black/20 px-3 py-2 transition-colors hover:border-white/20 hover:bg-white/5"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-1.5 text-[13px] text-white/80">
                            <span className="text-[11px] font-semibold text-white/30">#{i + 1}</span>
                            <span className="truncate font-medium capitalize text-white">{s.leg.commodity}</span>
                            <span className="truncate capitalize text-white/50">
                              → {s.leg.toName ?? s.leg.toLocation}
                            </span>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            {hasFuelData && (
                              <FuelBadge fuelScu={s.leg.fuelScu} over={i === refuelAtStep} t={t} />
                            )}
                            <span className="text-[13px] font-semibold text-emerald-400">+{fmt(s.leg.profit)}</span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onLoadToHold(shipName, s.leg.commodity, s.leg.quantityScu);
                              }}
                              title={t("cargo.loadToHold")}
                              className="inline-flex items-center gap-1 rounded-md border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/20"
                            >
                              <Truck className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Carrefour courant */}
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            {!graph ? (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-white/40">
                <Truck className="h-8 w-8 opacity-40" />
                <p className="text-sm">{t("cargo.gps.pickShipFirst")}</p>
              </div>
            ) : !startKey ? (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-white/40">
                <PackageSearch className="h-8 w-8 opacity-40" />
                <p className="text-sm">{t("cargo.gps.noStart")}</p>
              </div>
            ) : (
              <>
                <p className="mb-1 text-xs font-semibold uppercase tracking-[0.12em] text-white/50">
                  {t("cargo.gps.buyableHere")}
                </p>
                <p className="mb-4 text-sm font-semibold capitalize text-[var(--accent)]">
                  {t("cargo.gps.fromLocation", { loc: currentName })}
                </p>

                {rows.length === 0 ? (
                  <p className="py-10 text-center text-sm text-white/50">{t("cargo.gps.noBuyable")}</p>
                ) : (
                  <div className="flex flex-col gap-2.5">
                    {rows.map(({ item, options }) => {
                      const best = options[0];
                      const isOpen = expanded === item.commodity;
                      const others = options.slice(1);
                      if (item.outOfStock) {
                        return (
                          <div
                            key={item.commodity}
                            className="rounded-xl border border-white/10 bg-black/10 px-4 py-3 opacity-50"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <span className="truncate text-sm font-medium capitalize text-white/60 line-through">
                                {item.commodity}
                              </span>
                              <span className="rounded-md border border-red-400/30 bg-red-400/10 px-1.5 py-0.5 text-[10px] font-medium text-red-300">
                                {t("cargo.gps.outOfStock")}
                              </span>
                            </div>
                          </div>
                        );
                      }
                      return (
                        <div
                          key={item.commodity}
                          className="rounded-xl border border-white/10 bg-black/20 px-4 py-3"
                        >
                          <div
                            role={best ? "button" : undefined}
                            tabIndex={best ? 0 : undefined}
                            onClick={() => best && setExpanded(isOpen ? null : item.commodity)}
                            onKeyDown={(e) => {
                              if (best && (e.key === "Enter" || e.key === " ")) {
                                e.preventDefault();
                                setExpanded(isOpen ? null : item.commodity);
                              }
                            }}
                            className={best ? "cursor-pointer" : ""}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex min-w-0 items-center gap-2">
                                <span className="truncate text-sm font-semibold capitalize text-white">
                                  {item.commodity}
                                </span>
                                <span className="shrink-0 text-[11px] text-white/40">
                                  {t("cargo.results.buy")} {fmt(item.buyPrice)} aUEC/SCU
                                </span>
                              </div>
                              {best && (
                                <span className="shrink-0 text-sm font-semibold text-emerald-400">
                                  +{fmt(best.profit)}
                                </span>
                              )}
                            </div>

                            {best ? (
                              <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-white/60">
                                <span className="text-[10px] uppercase tracking-wide text-white/30">
                                  {t("cargo.gps.bestResale")}
                                </span>
                                <span className="capitalize text-white/80">{best.toName ?? best.toLocation}</span>
                                <span className="text-white/40">·</span>
                                <span>
                                  {best.distanceGm != null ? `${best.distanceGm.toFixed(2)} Gm` : "—"} ·{" "}
                                  {best.timeMinutes != null
                                    ? `${best.timeMinutes.toFixed(1)} ${t("cargo.unit.min")}`
                                    : "—"}
                                </span>
                                <AffluenceBadge level={best.affluence} t={t} />
                                {hasFuelData && <FuelBadge fuelScu={best.fuelScu} over={legUnreachable(best)} t={t} />}
                              </div>
                            ) : (
                              <p className="mt-1.5 text-[12px] text-white/40">{t("cargo.gps.noResale")}</p>
                            )}
                          </div>

                          {best && (
                            <div className="mt-2.5 flex items-center justify-between gap-2">
                              <button
                                type="button"
                                onClick={() => confirmLeg(best)}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-[12px] font-semibold text-white transition-opacity hover:opacity-90"
                              >
                                {t("cargo.gps.confirm")}
                                <ArrowRight className="h-3.5 w-3.5" />
                              </button>
                              {others.length > 0 && (
                                <button
                                  type="button"
                                  onClick={() => setExpanded(isOpen ? null : item.commodity)}
                                  className="rounded-lg border border-white/10 px-2.5 py-1 text-[11px] text-white/60 hover:bg-white/10"
                                >
                                  {t("cargo.gps.otherResales", { n: others.length })}
                                </button>
                              )}
                            </div>
                          )}

                          {/* Reventes alternatives dépliées */}
                          {isOpen && others.length > 0 && (
                            <div className="mt-2.5 flex flex-col gap-1.5 border-t border-white/10 pt-2.5">
                              {others.map((opt, oi) => (
                                <div
                                  key={oi}
                                  className="flex items-center justify-between gap-2 rounded-lg bg-black/20 px-3 py-1.5 text-[12px]"
                                >
                                  <div className="flex min-w-0 items-center gap-2 text-white/70">
                                    <span className="truncate capitalize">{opt.toName ?? opt.toLocation}</span>
                                    <span className="shrink-0 text-white/40">
                                      {opt.distanceGm != null ? `${opt.distanceGm.toFixed(2)} Gm` : "—"}
                                    </span>
                                    <AffluenceBadge level={opt.affluence} t={t} />
                                    {hasFuelData && <FuelBadge fuelScu={opt.fuelScu} over={legUnreachable(opt)} t={t} />}
                                  </div>
                                  <div className="flex shrink-0 items-center gap-2">
                                    <span className="font-semibold text-emerald-400">+{fmt(opt.profit)}</span>
                                    <button
                                      type="button"
                                      onClick={() => confirmLeg(opt)}
                                      className="rounded-md bg-[var(--accent)]/80 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-[var(--accent)]"
                                    >
                                      {t("cargo.gps.confirm")}
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {selectedRoute && <RouteDetailsModal route={selectedRoute} onClose={() => setSelectedRoute(null)} />}
      {showMap && graph && startKey && (
        <TripMapModal steps={steps} startKey={startKey} graph={graph} onClose={() => setShowMap(false)} />
      )}
    </>
  );
}

/* ── Wrapper : onglets Planificateur / Grille de soute ── */
// Demande de chargement transmise du planificateur vers la grille (nonce = re-déclenche).

export { GpsTradingTab };
