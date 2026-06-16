import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { Loader2, PackageSearch, ArrowRight, Truck } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { RouteDetailsModal } from "../components/RouteDetailsModal";
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
  const [group, setGroup] = useState<ShipGroup>("fleet");
  const [prices, setPrices] = useState<PricesStatus | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(true);

  const [shipName, setShipName] = useState<string>("");
  const [budget, setBudget] = useState<string>("1000000");
  const [system, setSystem] = useState<string>("");

  const [calculating, setCalculating] = useState(false);
  const [result, setResult] = useState<FindRoutesResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<CargoRoute | null>(null);

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
        // Par défaut : flotte si non vide, sinon catalogue.
        if (fleet.length > 0) {
          setGroup("fleet");
          setShipName(fleet[0].name);
        } else if (catalog.length > 0) {
          setGroup("all");
          setShipName(catalog[0].name);
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
  const [group, setGroup] = useState<ShipGroup>("fleet");
  const [commodities, setCommodities] = useState<string[]>([]);
  const [prices, setPrices] = useState<PricesStatus | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(true);

  const [resource, setResource] = useState<string>("");
  const [shipName, setShipName] = useState<string>("");
  const [budget, setBudget] = useState<string>("1000000");
  const [system, setSystem] = useState<string>("");
  const [mode, setMode] = useState<"closed" | "open">("closed");
  const [maxPoints, setMaxPoints] = useState<number>(4);
  const [unlimited, setUnlimited] = useState<boolean>(false);

  const [calculating, setCalculating] = useState(false);
  const [result, setResult] = useState<LoopResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<CargoRoute | null>(null);

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
        if (comms.length > 0) setResource(comms[0]);
        if (fleet.length > 0) {
          setGroup("fleet");
          setShipName(fleet[0].name);
        } else if (catalog.length > 0) {
          setGroup("all");
          setShipName(catalog[0].name);
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

/* ── Wrapper : onglets Planificateur / Grille de soute ── */
// Demande de chargement transmise du planificateur vers la grille (nonce = re-déclenche).
export type LoadToHoldRequest = { shipName: string; commodity: string; scu: number; nonce: number };

export default function CargoRoutesPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"single" | "loop" | "grid">("single");
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
