import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";
import { usePersistentState } from "../lib/uiPersist";
import { Loader2, PackageSearch, ArrowRight, Truck, Fuel } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { RouteDetailsModal } from "../components/RouteDetailsModal";
import { TripMapModal } from "../components/TripMapModal";
import { CargoGridTab } from "../components/CargoGridTab";
import StatCard from "../components/ui/StatCard";
import Dropdown from "../components/ui/Dropdown";

/* ── Types (miroir des structs Rust, camelCase serde) ── */
type FleetShip = {
  name: string;
  manufacturer: string | null;
  cargoScu: number | null;
  role: string | null;
  qtDefault?: boolean; // présent pour le catalogue (groupe « tous cargo »)
};
type ShipGroup = "fleet" | "all";
// Identité minimale d'une route transmise par le widget dashboard pour pré-ouverture.
type PendingRoute = {
  shipName: string;
  commodity: string;
  fromLocation: string;
  toLocation: string;
};
export type CargoRoute = {
  commodity: string;
  fromLocation: string;
  toLocation: string;
  fromName: string | null;
  toName: string | null;
  fromUuid: string | null;
  toUuid: string | null;
  buyPrice: number;
  sellPrice: number;
  marginUnit: number;
  quantityScu: number;
  profit: number;
  fromSystem: string | null;
  toSystem: string | null;
  jumps: number | null;
  distanceGm: number | null;
  timeMinutes: number | null;
  profitPerMinute: number | null;
  priceTimestamp: string | null;
  fuel: number | null;
  // Carburant quantique consommé par ce leg (SCU) = distanceGm × conso drive. null si non synchro.
  fuelScu: number | null;
};
type FindRoutesResult = {
  shipName: string;
  cargoScu: number | null;
  qtResolved: boolean;
  investment: number;
  routesConsidered: number;
  routesWithTime: number;
  routes: CargoRoute[];
  note: string;
};
type LoopResult = {
  legs: CargoRoute[];
  totalProfit: number;
  totalTimeMinutes: number | null;
  hops: number;
  closed: boolean;
  startLocation: string;
  endLocation: string;
  note: string | null;
};
type PricesStatus = {
  rows: number;
  terminals: number;
  terminalsMapped: number;
  freshestTimestamp: string | null;
  sellPointsWithDemand: number;
};

/* ── Types GPS trading (miroir TradeGraph Rust) ── */
export type Affluence = "low" | "medium" | "high";
export type GpsLeg = CargoRoute & { fromKey: string; toKey: string; affluence: Affluence };
type GpsBuyItem = {
  commodity: string;
  buyPrice: number;
  stock: number | null;
  statusBuy: number | null;
  outOfStock: boolean;
};
type GpsLocation = { key: string; name: string; system: string | null };
export type GpsPos = { x: number; y: number; z: number; system: string | null };
export type TradeGraph = {
  shipName: string;
  cargoScu: number | null;
  qtResolved: boolean;
  // Autonomie quantique max (Gm) et capacité réservoir (SCU). null si non synchronisées.
  quantumRangeGm: number | null;
  quantumFuelScu: number | null;
  legsFrom: Record<string, GpsLeg[]>;
  buyableAt: Record<string, GpsBuyItem[]>;
  positions: Record<string, GpsPos>;
  locations: GpsLocation[];
};
// Une étape confirmée du trajet GPS (leg = CargoRoute → modale + soute compatibles).
export type GpsStep = { leg: GpsLeg };

const SYSTEMS = ["stanton", "pyro", "nyx"] as const;

/* ── Helpers ── */
function fmt(n: number): string {
  return Math.round(n).toLocaleString("fr-FR");
}
function relativeAge(iso: string | null, t: TFunction): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const mins = Math.max(0, Math.floor((Date.now() - then) / 60000));
  if (mins < 60) return t("cargo.ageMinutes", { n: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 48) return t("cargo.ageHours", { n: hours });
  return t("cargo.ageDays", { n: Math.floor(hours / 24) });
}

function PlannerTab({ onLoadToHold }: { onLoadToHold: (shipName: string, commodity: string, scu: number) => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // Route ciblée depuis le widget dashboard : { shipName, commodity, fromLocation, toLocation }.
  // On sélectionne ce vaisseau, on calcule, et on ouvre la modale de la route correspondante.
  const location = useLocation();
  const pendingRoute =
    (location.state as { route?: PendingRoute } | null)?.route ?? null;
  const appliedRef = useRef(false);

  const [fleetShips, setFleetShips] = useState<FleetShip[]>([]);
  const [catalogShips, setCatalogShips] = useState<FleetShip[]>([]);
  const [group, setGroup] = usePersistentState<ShipGroup>("cargo.single.group", "fleet");
  const [prices, setPrices] = useState<PricesStatus | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(true);

  const [shipName, setShipName] = usePersistentState<string>("cargo.single.ship", "");
  const [budget, setBudget] = usePersistentState<string>("cargo.single.budget", "1000000");
  const [system, setSystem] = usePersistentState<string>("cargo.single.system", "");

  const [calculating, setCalculating] = useState(false);
  const [result, setResult] = useState<FindRoutesResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedRoute, setSelectedRoute] = usePersistentState<CargoRoute | null>("cargo.single.route", null);

  // Chargement initial : flotte + catalogue cargo + état du cache de prix.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [fleet, catalog, status] = await Promise.all([
          invoke<FleetShip[]>("get_cargo_fleet_ships"),
          invoke<FleetShip[]>("get_cargo_catalog_ships"),
          invoke<PricesStatus>("get_uex_prices_status"),
        ]);
        if (!alive) return;
        setFleetShips(fleet);
        setCatalogShips(catalog);
        setPrices(status);
        // Par défaut : flotte si non vide, sinon catalogue — UNIQUEMENT si rien n'a été
        // restauré (sessionStorage), sinon on garde la sélection persistée de l'utilisateur.
        if (!shipName) {
          if (fleet.length > 0) {
            setGroup("fleet");
            setShipName(fleet[0].name);
          } else if (catalog.length > 0) {
            setGroup("all");
            setShipName(catalog[0].name);
          }
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoadingMeta(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const ships = group === "fleet" ? fleetShips : catalogShips;

  // Bascule de groupe : recharge le sélecteur sur le 1er vaisseau du groupe.
  function switchGroup(g: ShipGroup) {
    setGroup(g);
    const list = g === "fleet" ? fleetShips : catalogShips;
    setShipName(list.length > 0 ? list[0].name : "");
  }

  const selectedShip = useMemo(
    () => ships.find((s) => s.name === shipName) ?? null,
    [ships, shipName],
  );
  const bestProfit = result?.routes?.[0]?.profit ?? null;
  const hasPrices = (prices?.rows ?? 0) > 0;

  async function calculate(opts?: { shipNameOverride?: string; openRoute?: PendingRoute }) {
    setError(null);
    setResult(null);
    const sn = opts?.shipNameOverride ?? shipName;
    const investment = Number(budget);
    if (!sn) {
      setError(t("cargo.err.noShip"));
      return;
    }
    if (!Number.isFinite(investment) || investment <= 0) {
      setError(t("cargo.err.budget"));
      return;
    }
    setCalculating(true);
    try {
      const r = await invoke<FindRoutesResult>("find_cargo_routes", {
        shipName: sn,
        investment,
        system: system || null,
        limit: 50,
      });
      setResult(r);
      // Pré-ouverture (depuis le widget) : ouvre la modale de la route correspondante.
      if (opts?.openRoute) {
        const tgt = opts.openRoute;
        const match = r.routes.find(
          (x) =>
            x.commodity === tgt.commodity &&
            x.fromLocation === tgt.fromLocation &&
            x.toLocation === tgt.toLocation,
        );
        if (match) setSelectedRoute(match);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCalculating(false);
    }
  }

  // Arrivée depuis le widget « Top routes » : une fois la meta chargée, sélectionne le
  // vaisseau cible (flotte du compte actif), calcule, puis ouvre la route. Une seule fois.
  useEffect(() => {
    if (loadingMeta || appliedRef.current || !pendingRoute) return;
    appliedRef.current = true;
    setGroup("fleet");
    setShipName(pendingRoute.shipName);
    void calculate({ shipNameOverride: pendingRoute.shipName, openRoute: pendingRoute });
    // Consomme le state de navigation (pas de ré-ouverture au toggle d'onglet / refresh).
    navigate(location.pathname, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingMeta, pendingRoute]);

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

      {/* Récapitulatif */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label={t("cargo.statShip")}>
          <div className="text-lg font-semibold text-white">{selectedShip?.name ?? "—"}</div>
          <div className="text-xs text-white/50">
            {selectedShip?.manufacturer ?? ""}
            {selectedShip?.role ? ` · ${selectedShip.role}` : ""}
          </div>
        </StatCard>
        <StatCard label={t("cargo.statCapacity")}>
          <div className="text-lg font-semibold text-[var(--accent)]">
            {selectedShip?.cargoScu != null ? `${fmt(selectedShip.cargoScu)} SCU` : "—"}
          </div>
          <div className="text-xs text-white/50">
            {result?.qtResolved === false ? t("cargo.qtUnresolved") : ""}
          </div>
        </StatCard>
        <StatCard label={t("cargo.statBestProfit")}>
          <div className="text-lg font-semibold text-emerald-400">
            {bestProfit != null ? `${fmt(bestProfit)} aUEC` : "—"}
          </div>
          <div className="text-xs text-white/50">
            {result ? t("cargo.routesCount", { n: result.routes.length }) : ""}
          </div>
        </StatCard>
      </div>

      {error && (
        <p className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[340px_1fr]">
        {/* Formulaire */}
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.12em] text-white/50">
            {t("cargo.form.title")}
          </p>

          {loadingMeta ? (
            <div className="flex items-center gap-2 text-sm text-white/50">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("cargo.loading")}
            </div>
          ) : fleetShips.length === 0 && catalogShips.length === 0 ? (
            <p className="text-sm text-white/50">{t("cargo.empty.noShips")}</p>
          ) : (
            <>
              {/* Groupe : Ma flotte / Tous les vaisseaux cargo */}
              <Field label={t("cargo.form.group")}>
                <div className="flex overflow-hidden rounded-lg border border-white/10">
                  <button
                    type="button"
                    onClick={() => switchGroup("fleet")}
                    disabled={fleetShips.length === 0}
                    className={`flex-1 px-3 py-2 text-xs font-medium transition-colors disabled:opacity-40 ${
                      group === "fleet" ? "bg-[var(--accent)] text-white" : "bg-white/5 text-white/60 hover:bg-white/10"
                    }`}
                  >
                    {t("cargo.form.groupFleet")} ({fleetShips.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => switchGroup("all")}
                    className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
                      group === "all" ? "bg-[var(--accent)] text-white" : "bg-white/5 text-white/60 hover:bg-white/10"
                    }`}
                  >
                    {t("cargo.form.groupAll")} ({catalogShips.length})
                  </button>
                </div>
              </Field>

              <Field label={t("cargo.form.ship")}>
                <Dropdown
                  value={shipName}
                  onChange={setShipName}
                  ariaLabel={t("cargo.form.ship")}
                  options={ships.map((s) => ({
                    value: s.name,
                    label: `${s.name}${s.cargoScu != null ? ` · ${s.cargoScu} SCU` : ""}${
                      s.qtDefault === false ? " · QT ?" : ""
                    }`,
                  }))}
                />
                {selectedShip?.qtDefault === false && (
                  <p className="mt-1 text-[11px] text-accent/80">{t("cargo.form.noQtDefault")}</p>
                )}
              </Field>

              <Field label={t("cargo.form.budget")}>
                <input
                  type="number"
                  min={0}
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none"
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

              <button
                type="button"
                onClick={() => void calculate()}
                disabled={calculating || !hasPrices}
                className="mt-1 flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {calculating ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageSearch className="h-4 w-4" />}
                {calculating ? t("cargo.form.calculating") : t("cargo.form.calculate")}
              </button>

              {!hasPrices && (
                <button
                  type="button"
                  onClick={() => navigate("/settings")}
                  className="mt-3 w-full rounded-lg border border-[var(--accent)]/50 px-3 py-2 text-xs text-[var(--accent)] hover:bg-white/5"
                >
                  {t("cargo.empty.noPricesCta")}
                </button>
              )}

              <p className="mt-4 border-t border-white/10 pt-3 text-[11px] leading-relaxed text-white/40">
                {hasPrices
                  ? t("cargo.priceFooter", {
                      rows: fmt(prices?.rows ?? 0),
                      locs: prices?.terminals ?? 0,
                      age: relativeAge(prices?.freshestTimestamp ?? null, t),
                    })
                  : t("cargo.empty.noPrices")}
              </p>
            </>
          )}
        </div>

        {/* Résultats */}
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.12em] text-white/50">
            {t("cargo.results.title")}
          </p>

          {!result ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-white/40">
              <Truck className="h-8 w-8 opacity-40" />
              <p className="text-sm">{t("cargo.results.empty")}</p>
            </div>
          ) : result.routes.length === 0 ? (
            <p className="py-12 text-center text-sm text-white/50">{t("cargo.results.none")}</p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {result.routes.map((r, i) => (
                <RouteRow
                  key={i}
                  r={r}
                  rank={i + 1}
                  t={t}
                  onClick={() => setSelectedRoute(r)}
                  onLoad={() => onLoadToHold(shipName, r.commodity, r.quantityScu)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {selectedRoute && (
        <RouteDetailsModal route={selectedRoute} onClose={() => setSelectedRoute(null)} />
      )}
    </>
  );
}

/* ── Onglet : Planificateur de BOUCLE (chaîne de routes rentables) ── */
function LoopPlannerTab({
  onLoadToHold,
}: {
  onLoadToHold: (shipName: string, commodity: string, scu: number) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [fleetShips, setFleetShips] = useState<FleetShip[]>([]);
  const [catalogShips, setCatalogShips] = useState<FleetShip[]>([]);
  const [group, setGroup] = usePersistentState<ShipGroup>("cargo.loop.group", "fleet");
  const [commodities, setCommodities] = useState<string[]>([]);
  const [prices, setPrices] = useState<PricesStatus | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(true);

  const [resource, setResource] = usePersistentState<string>("cargo.loop.resource", "");
  const [shipName, setShipName] = usePersistentState<string>("cargo.loop.ship", "");
  const [budget, setBudget] = usePersistentState<string>("cargo.loop.budget", "1000000");
  const [system, setSystem] = usePersistentState<string>("cargo.loop.system", "");
  const [mode, setMode] = usePersistentState<"closed" | "open">("cargo.loop.mode", "closed");
  const [maxPoints, setMaxPoints] = usePersistentState<number>("cargo.loop.maxPoints", 4);
  const [unlimited, setUnlimited] = usePersistentState<boolean>("cargo.loop.unlimited", false);

  const [calculating, setCalculating] = useState(false);
  const [result, setResult] = useState<LoopResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedRoute, setSelectedRoute] = usePersistentState<CargoRoute | null>("cargo.loop.route", null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [fleet, catalog, status, comms] = await Promise.all([
          invoke<FleetShip[]>("get_cargo_fleet_ships"),
          invoke<FleetShip[]>("get_cargo_catalog_ships"),
          invoke<PricesStatus>("get_uex_prices_status"),
          invoke<string[]>("get_cargo_commodities"),
        ]);
        if (!alive) return;
        setFleetShips(fleet);
        setCatalogShips(catalog);
        setPrices(status);
        setCommodities(comms);
        // Défauts seulement si rien n'a été restauré (sinon on garde la sélection persistée).
        if (!resource && comms.length > 0) setResource(comms[0]);
        if (!shipName) {
          if (fleet.length > 0) {
            setGroup("fleet");
            setShipName(fleet[0].name);
          } else if (catalog.length > 0) {
            setGroup("all");
            setShipName(catalog[0].name);
          }
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoadingMeta(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const ships = group === "fleet" ? fleetShips : catalogShips;
  function switchGroup(g: ShipGroup) {
    setGroup(g);
    const list = g === "fleet" ? fleetShips : catalogShips;
    setShipName(list.length > 0 ? list[0].name : "");
  }
  const hasPrices = (prices?.rows ?? 0) > 0;

  async function calculate() {
    setError(null);
    setResult(null);
    const inv = Number(budget);
    if (!resource) {
      setError(t("cargo.loop.errNoResource"));
      return;
    }
    if (!shipName) {
      setError(t("cargo.err.noShip"));
      return;
    }
    if (!Number.isFinite(inv) || inv <= 0) {
      setError(t("cargo.err.budget"));
      return;
    }
    setCalculating(true);
    try {
      const r = await invoke<LoopResult>("find_cargo_loop", {
        resource,
        shipName,
        budget: inv,
        mode,
        maxHops: unlimited ? null : maxPoints,
        system: system || null,
      });
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCalculating(false);
    }
  }

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

      <div className="mt-2 grid grid-cols-1 gap-5 lg:grid-cols-[340px_1fr]">
        {/* Formulaire */}
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.12em] text-white/50">
            {t("cargo.form.title")}
          </p>

          {loadingMeta ? (
            <div className="flex items-center gap-2 text-sm text-white/50">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("cargo.loading")}
            </div>
          ) : fleetShips.length === 0 && catalogShips.length === 0 ? (
            <p className="text-sm text-white/50">{t("cargo.empty.noShips")}</p>
          ) : (
            <>
              <Field label={t("cargo.loop.resource")}>
                <Dropdown
                  value={resource}
                  onChange={setResource}
                  ariaLabel={t("cargo.loop.resource")}
                  searchable
                  options={commodities.map((c) => ({ value: c, label: c }))}
                />
              </Field>

              <Field label={t("cargo.form.group")}>
                <div className="flex overflow-hidden rounded-lg border border-white/10">
                  <button
                    type="button"
                    onClick={() => switchGroup("fleet")}
                    disabled={fleetShips.length === 0}
                    className={`flex-1 px-3 py-2 text-xs font-medium transition-colors disabled:opacity-40 ${
                      group === "fleet" ? "bg-[var(--accent)] text-white" : "bg-white/5 text-white/60 hover:bg-white/10"
                    }`}
                  >
                    {t("cargo.form.groupFleet")} ({fleetShips.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => switchGroup("all")}
                    className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
                      group === "all" ? "bg-[var(--accent)] text-white" : "bg-white/5 text-white/60 hover:bg-white/10"
                    }`}
                  >
                    {t("cargo.form.groupAll")} ({catalogShips.length})
                  </button>
                </div>
              </Field>

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

              <Field label={t("cargo.form.budget")}>
                <input
                  type="number"
                  min={0}
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none"
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

              <Field label={t("cargo.loop.mode")}>
                <div className="grid grid-cols-1 gap-2">
                  {(["closed", "open"] as const).map((mk) => {
                    const active = mode === mk;
                    return (
                      <button
                        key={mk}
                        type="button"
                        onClick={() => setMode(mk)}
                        className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                          active
                            ? "border-[var(--accent)] bg-[var(--accent)]/10"
                            : "border-white/10 bg-white/5 hover:bg-white/10"
                        }`}
                      >
                        <div className={`text-sm font-semibold ${active ? "text-[var(--accent)]" : "text-white"}`}>
                          {t(mk === "closed" ? "cargo.loop.modeClosed" : "cargo.loop.modeOpen")}
                        </div>
                        <div className="mt-0.5 text-[11px] leading-snug text-white/50">
                          {t(mk === "closed" ? "cargo.loop.modeClosedDesc" : "cargo.loop.modeOpenDesc")}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </Field>

              <Field label={t("cargo.loop.points")}>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={1}
                    max={10}
                    value={maxPoints}
                    disabled={unlimited}
                    onChange={(e) => setMaxPoints(Number(e.target.value))}
                    className="flex-1 accent-[var(--accent)] disabled:opacity-40"
                  />
                  <span className="w-8 text-center text-sm font-semibold text-white">
                    {unlimited ? "∞" : maxPoints}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setUnlimited((u) => !u)}
                  className={`mt-2 w-full rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                    unlimited
                      ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                      : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10"
                  }`}
                >
                  {t("cargo.loop.unlimited")}
                </button>
              </Field>

              <button
                type="button"
                onClick={() => void calculate()}
                disabled={calculating || !hasPrices}
                className="mt-1 flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {calculating ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageSearch className="h-4 w-4" />}
                {calculating ? t("cargo.form.calculating") : t("cargo.form.calculate")}
              </button>

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
          )}
        </div>

        {/* Résultat */}
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.12em] text-white/50">
            {t("cargo.loop.resultTitle")}
          </p>

          {!result ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-white/40">
              <Truck className="h-8 w-8 opacity-40" />
              <p className="text-sm">{t("cargo.loop.resultsEmpty")}</p>
            </div>
          ) : result.legs.length === 0 ? (
            <p className="py-12 text-center text-sm text-white/50">
              {result.note ??
                t(mode === "closed" ? "cargo.loop.emptyClosed" : "cargo.loop.emptyOpen")}
            </p>
          ) : (
            <>
              <div className="mb-4 rounded-xl border border-[var(--accent)]/25 bg-[var(--accent)]/[0.06] px-4 py-3">
                <div className="text-sm font-semibold text-white">
                  {result.closed
                    ? t("cargo.loop.closedRecap", { loc: result.startLocation })
                    : t("cargo.loop.openRecap", { loc: result.endLocation })}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-white/60">
                  <span>
                    {t("cargo.loop.totalProfit")}{" "}
                    <span className="font-semibold text-emerald-400">+{fmt(result.totalProfit)} aUEC</span>
                  </span>
                  <span>
                    {t("cargo.loop.totalTime")}{" "}
                    <span className="text-white/80">
                      {result.totalTimeMinutes != null
                        ? `${result.totalTimeMinutes.toFixed(1)} ${t("cargo.unit.min")}`
                        : "—"}
                    </span>
                  </span>
                  <span>
                    {t("cargo.loop.hops")} <span className="text-white/80">{result.hops}</span>
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-2.5">
                {result.legs.map((r, i) => (
                  <RouteRow
                    key={i}
                    r={r}
                    rank={i + 1}
                    t={t}
                    onClick={() => setSelectedRoute(r)}
                    onLoad={() => onLoadToHold(shipName, r.commodity, r.quantityScu)}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {selectedRoute && (
        <RouteDetailsModal route={selectedRoute} onClose={() => setSelectedRoute(null)} />
      )}
    </>
  );
}

/* ── Onglet : GPS trading (navigation pas-à-pas pilotée par l'utilisateur) ── */
function AffluenceBadge({ level, t }: { level: Affluence; t: TFunction }) {
  const map: Record<Affluence, { label: string; cls: string }> = {
    low: { label: t("cargo.gps.affLow"), cls: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300" },
    medium: { label: t("cargo.gps.affMedium"), cls: "border-amber-400/40 bg-amber-400/10 text-amber-300" },
    high: { label: t("cargo.gps.affHigh"), cls: "border-red-400/40 bg-red-400/10 text-red-300" },
  };
  const m = map[level];
  return (
    <span
      title={t("cargo.gps.affTitle")}
      className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${m.cls}`}
    >
      {t("cargo.gps.affEstimated")} · {m.label}
    </span>
  );
}

/* Badge carburant quantique d'un leg : coût en SCU. Passe au rouge + « ravitaillement » quand
   `over` (le leg dépasse le carburant restant sur le trajet cumulé). Le caller ne le rend que
   si l'autonomie du vaisseau est connue. */
function FuelBadge({ fuelScu, over, t }: { fuelScu: number | null; over?: boolean; t: TFunction }) {
  return (
    <span
      title={over ? t("cargo.gps.refuelTitle") : t("cargo.gps.fuelTitle")}
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${
        over ? "border-red-400/40 bg-red-400/10 text-red-300" : "border-sky-400/30 bg-sky-400/10 text-sky-300"
      }`}
    >
      <Fuel className="h-3 w-3" />
      {fuelScu != null ? `${fuelScu.toFixed(2)} SCU` : "—"}
      {over && ` · ${t("cargo.gps.refuelNeeded")}`}
    </span>
  );
}

function GpsTradingTab({
  onLoadToHold,
}: {
  onLoadToHold: (shipName: string, commodity: string, scu: number) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [fleetShips, setFleetShips] = useState<FleetShip[]>([]);
  const [catalogShips, setCatalogShips] = useState<FleetShip[]>([]);
  const [group, setGroup] = usePersistentState<ShipGroup>("cargo.gps.group", "fleet");
  const [prices, setPrices] = useState<PricesStatus | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(true);

  const [shipName, setShipName] = usePersistentState<string>("cargo.gps.ship", "");
  const [system, setSystem] = usePersistentState<string>("cargo.gps.system", "");

  const [loadingGraph, setLoadingGraph] = useState(false);
  const [graph, setGraph] = useState<TradeGraph | null>(null);
  const [error, setError] = useState<string | null>(null);

  // État de navigation (100 % front) : départ + étapes confirmées — persisté.
  const [startKey, setStartKey] = usePersistentState<string>("cargo.gps.startKey", "");
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

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [fleet, catalog, status] = await Promise.all([
          invoke<FleetShip[]>("get_cargo_fleet_ships"),
          invoke<FleetShip[]>("get_cargo_catalog_ships"),
          invoke<PricesStatus>("get_uex_prices_status"),
        ]);
        if (!alive) return;
        setFleetShips(fleet);
        setCatalogShips(catalog);
        setPrices(status);
        // Défaut seulement si rien n'a été restauré (sinon on garde la sélection persistée).
        if (!shipName) {
          if (fleet.length > 0) {
            setGroup("fleet");
            setShipName(fleet[0].name);
          } else if (catalog.length > 0) {
            setGroup("all");
            setShipName(catalog[0].name);
          }
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoadingMeta(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const ships = group === "fleet" ? fleetShips : catalogShips;
  function switchGroup(g: ShipGroup) {
    setGroup(g);
    const list = g === "fleet" ? fleetShips : catalogShips;
    setShipName(list.length > 0 ? list[0].name : "");
  }
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

  // Phase 2 — pousse la destination GPS courante vers l'overlay en jeu. L'overlay est
  // une autre fenêtre (sessionStorage non partagé) → on passe par AppMeta + un event.
  useEffect(() => {
    const nav = selectedRoute
      ? {
          commodity: selectedRoute.commodity,
          from: selectedRoute.fromLocation,
          to: selectedRoute.toLocation,
          profit: selectedRoute.profit,
          shipName,
        }
      : null;
    void invoke("set_app_meta", { key: "overlay.nav", value: JSON.stringify(nav) }).catch(
      () => {},
    );
    void emit("overlay:nav", nav).catch(() => {});
  }, [selectedRoute, shipName]);
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

      <div className="mt-2 grid grid-cols-1 gap-5 lg:grid-cols-[340px_1fr]">
        {/* Formulaire : vaisseau + système + chargement du graphe + départ */}
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-white/50">
            {t("cargo.form.title")}
          </p>
          <p className="mb-4 text-[11px] leading-relaxed text-white/40">{t("cargo.gps.intro")}</p>

          {loadingMeta ? (
            <div className="flex items-center gap-2 text-sm text-white/50">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("cargo.loading")}
            </div>
          ) : fleetShips.length === 0 && catalogShips.length === 0 ? (
            <p className="text-sm text-white/50">{t("cargo.empty.noShips")}</p>
          ) : (
            <>
              <Field label={t("cargo.form.group")}>
                <div className="flex overflow-hidden rounded-lg border border-white/10">
                  <button
                    type="button"
                    onClick={() => switchGroup("fleet")}
                    disabled={fleetShips.length === 0}
                    className={`flex-1 px-3 py-2 text-xs font-medium transition-colors disabled:opacity-40 ${
                      group === "fleet" ? "bg-[var(--accent)] text-white" : "bg-white/5 text-white/60 hover:bg-white/10"
                    }`}
                  >
                    {t("cargo.form.groupFleet")} ({fleetShips.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => switchGroup("all")}
                    className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
                      group === "all" ? "bg-[var(--accent)] text-white" : "bg-white/5 text-white/60 hover:bg-white/10"
                    }`}
                  >
                    {t("cargo.form.groupAll")} ({catalogShips.length})
                  </button>
                </div>
              </Field>

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
export type LoadToHoldRequest = { shipName: string; commodity: string; scu: number; nonce: number };

export default function CargoRoutesPage() {
  const { t } = useTranslation();
  const [tab, setTab] = usePersistentState<"single" | "loop" | "gps" | "grid">("cargoRoutes.tab", "single");
  const [loadReq, setLoadReq] = useState<LoadToHoldRequest | null>(null);

  // Depuis une route du planificateur : vers la grille avec vaisseau + manifeste pré-rempli.
  function loadToHold(shipName: string, commodity: string, scu: number) {
    setLoadReq({ shipName, commodity, scu, nonce: Date.now() });
    setTab("grid");
  }

  return (
    <div className="p-8">
      <header className="mb-1">
        <p className="text-xs uppercase tracking-[0.18em] text-white/40">{t("cargo.eyebrow")}</p>
        <h1 className="text-2xl font-bold text-white">{t("cargo.title")}</h1>
      </header>
      <div className="mb-5 mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => setTab("single")}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            tab === "single" ? "bg-[var(--accent)] text-white" : "bg-white/5 text-white/60 hover:bg-white/10"
          }`}
        >
          {t("cargo.tabPlanner")}
        </button>
        <button
          type="button"
          onClick={() => setTab("loop")}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            tab === "loop" ? "bg-[var(--accent)] text-white" : "bg-white/5 text-white/60 hover:bg-white/10"
          }`}
        >
          {t("cargo.tabLoop")}
        </button>
        <button
          type="button"
          onClick={() => setTab("gps")}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            tab === "gps" ? "bg-[var(--accent)] text-white" : "bg-white/5 text-white/60 hover:bg-white/10"
          }`}
        >
          {t("cargo.tabGps")}
        </button>
        <button
          type="button"
          onClick={() => {
            setLoadReq(null); // navigation manuelle = grille vierge (comportement par défaut)
            setTab("grid");
          }}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            tab === "grid" ? "bg-[var(--accent)] text-white" : "bg-white/5 text-white/60 hover:bg-white/10"
          }`}
        >
          {t("cargo.tabGrid")}
        </button>
      </div>
      {tab === "single" ? (
        <PlannerTab onLoadToHold={loadToHold} />
      ) : tab === "loop" ? (
        <LoopPlannerTab onLoadToHold={loadToHold} />
      ) : tab === "gps" ? (
        <GpsTradingTab onLoadToHold={loadToHold} />
      ) : (
        <CargoGridTab loadRequest={loadReq} />
      )}
    </div>
  );
}

/* ── Sous-composants ── */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="mb-1 text-[11px] text-white/40">{label}</div>
      {children}
    </div>
  );
}

function RouteRow({
  r,
  rank,
  t,
  onClick,
  onLoad,
}: {
  r: CargoRoute;
  rank: number;
  t: TFunction;
  onClick: () => void;
  onLoad: () => void;
}) {
  const from = r.fromName ?? r.fromLocation;
  const to = r.toName ?? r.toLocation;
  const dash = "—";
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className="w-full cursor-pointer rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-left transition-colors hover:border-white/20 hover:bg-white/5"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-[11px] font-semibold text-white/30">#{rank}</span>
          <span className="truncate text-sm font-semibold capitalize text-white">{r.commodity}</span>
        </div>
        <div className="text-right">
          <div className="text-sm font-semibold text-emerald-400">+{fmt(r.profit)} aUEC</div>
          <div className="text-[11px] text-[var(--accent)]">
            {r.profitPerMinute != null ? `${fmt(r.profitPerMinute)} ${t("cargo.unit.perMin")}` : t("cargo.results.noTime")}
          </div>
        </div>
      </div>

      <div className="mt-1.5 flex items-center gap-1.5 text-[13px] text-white/70">
        <span className="truncate capitalize">{from}</span>
        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-white/30" />
        <span className="truncate capitalize">{to}</span>
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-white/50">
        <span>
          {t("cargo.results.buy")} <span className="text-white/70">{fmt(r.buyPrice)} aUEC/SCU</span>
        </span>
        <span>
          {t("cargo.results.sell")} <span className="text-white/70">{fmt(r.sellPrice)} aUEC/SCU</span>
        </span>
        <span>
          {t("cargo.results.margin")} <span className="text-white/70">{fmt(r.marginUnit)} aUEC/SCU</span>
        </span>
        <span>
          {t("cargo.results.qty")} <span className="text-white/70">{fmt(r.quantityScu)} SCU</span>
        </span>
        <span>
          {t("cargo.results.distance")}{" "}
          <span className="text-white/70">{r.distanceGm != null ? `${r.distanceGm.toFixed(2)} Gm` : dash}</span>
        </span>
        <span>
          {t("cargo.results.time")}{" "}
          <span className="text-white/70">
            {r.timeMinutes != null ? `${r.timeMinutes.toFixed(1)} ${t("cargo.unit.min")}` : dash}
          </span>
        </span>
        <span>
          {t("cargo.results.priceAge")}{" "}
          <span className="text-white/70">{relativeAge(r.priceTimestamp, t)}</span>
        </span>
      </div>

      <div className="mt-2.5 flex justify-end">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onLoad();
          }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-2.5 py-1 text-[11px] font-medium text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/20"
        >
          <Truck className="h-3.5 w-3.5" />
          {t("cargo.loadToHold")}
        </button>
      </div>
    </div>
  );
}
