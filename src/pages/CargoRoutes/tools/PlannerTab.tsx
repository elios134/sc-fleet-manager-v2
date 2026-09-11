import { useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { usePersistentState } from "../../../lib/uiPersist";
import { Loader2, PackageSearch, Truck, Box, Calculator, Play } from "lucide-react";
import { useTranslation } from "react-i18next";
import { RouteDetailsModal } from "../../../components/RouteDetailsModal";
import Dropdown from "../../../components/ui/Dropdown";
import { type PendingRoute, type CargoRoute, type FindRoutesResult, type RouteSort, type CargoCtx } from "../types";
import { legToStep, pushOverlayRoute, fmt, sortRoutes } from "../helpers";
import { RouteCard } from "../components/RouteCard";
import { RouteMap } from "../components/RouteMap";

function PlannerTab({ ctx, onLoadToHold, onStartConvoy }: {
  ctx: CargoCtx;
  onLoadToHold: (shipName: string, commodity: string, scu: number) => void;
  onStartConvoy: (route: CargoRoute) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // Route ciblée depuis le widget dashboard : { shipName, commodity, fromLocation, toLocation }.
  // On sélectionne ce vaisseau, on calcule, et on ouvre la modale de la route correspondante.
  const location = useLocation();
  const pendingRoute =
    (location.state as { route?: PendingRoute } | null)?.route ?? null;
  const appliedRef = useRef(false);

  // Contexte partagé (vaisseau · budget · système · flotte · prix) — remonté au wrapper cockpit.
  const { ships, shipName, budget, system, prices, setShipName } = ctx;

  const [calculating, setCalculating] = useState(false);
  const [result, setResult] = useState<FindRoutesResult | null>(null);
  const [routeSort, setRouteSort] = usePersistentState<RouteSort>("cargo.single.sort", "profit");
  const [error, setError] = useState<string | null>(null);
  const [selectedRoute, setSelectedRoute] = usePersistentState<CargoRoute | null>("cargo.single.route", null);
  const [modalRoute, setModalRoute] = useState<CargoRoute | null>(null);

  const hasPrices = (prices?.rows ?? 0) > 0;

  // Overlay en jeu : pousse la route simple choisie (1 étape).
  useEffect(() => {
    pushOverlayRoute(
      selectedRoute ? { source: "single", shipName, steps: [legToStep(selectedRoute)] } : null,
    );
  }, [selectedRoute, shipName]);

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
      // Pré-ouverture (depuis le widget) : sélectionne la route correspondante.
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

  // Arrivée depuis le widget « Top routes » : dès que la flotte est prête, sélectionne le
  // vaisseau cible, calcule, puis sélectionne la route. Une seule fois.
  useEffect(() => {
    if (appliedRef.current || !pendingRoute || ships.length === 0) return;
    appliedRef.current = true;
    setShipName(pendingRoute.shipName);
    void calculate({ shipNameOverride: pendingRoute.shipName, openRoute: pendingRoute });
    navigate(location.pathname, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRoute, ships.length]);

  const sorted = result ? sortRoutes(result.routes, routeSort) : [];
  const detail: CargoRoute | null = selectedRoute ?? sorted[0] ?? null;
  const highlightBest = routeSort !== "time";

  return (
    <>
      {error && (
        <p className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">{error}</p>
      )}

      {/* Barre d'action : calculer + tri */}
      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          onClick={() => void calculate()}
          disabled={calculating || !hasPrices || !shipName}
          className="inline-flex items-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {calculating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />}
          {calculating ? t("cargo.form.calculating") : t("cargo.form.calculate")}
        </button>
        {!hasPrices && (
          <button type="button" onClick={() => navigate("/settings")} className="rounded-xl border border-[var(--accent)]/50 px-3 py-2.5 text-xs text-[var(--accent)] hover:bg-white/5">
            {t("cargo.empty.noPricesCta")}
          </button>
        )}
        {result && result.routes.length > 0 && (
          <div className="ml-auto flex items-center gap-2 text-xs text-white/50">
            {t("cargo.sortLabel")}
            <Dropdown
              value={routeSort}
              onChange={(v) => setRouteSort(v as RouteSort)}
              buttonClassName="text-xs text-white/80"
              className="w-40"
              options={[
                { value: "profit", label: t("cargo.sortProfit") },
                { value: "ppm", label: t("cargo.sortPpm") },
                { value: "time", label: t("cargo.sortTime") },
              ]}
            />
          </div>
        )}
      </div>

      {/* Cockpit : cartes de route (gauche) + carte + détail (droite) */}
      <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-[1.45fr_1fr]">
        <div className="flex min-w-0 flex-col gap-2.5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/45">
            {result ? t("cargo.routesCount", { n: result.routes.length }) : t("cargo.results.title")}
          </span>
          {!result ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/10 py-16 text-center text-white/40">
              <Truck className="h-8 w-8 opacity-40" />
              <p className="text-sm">{t("cargo.results.empty")}</p>
            </div>
          ) : result.routes.length === 0 ? (
            <p className="rounded-2xl border border-white/10 py-12 text-center text-sm text-white/50">{t("cargo.results.none")}</p>
          ) : (
            sorted.map((r, i) => (
              <RouteCard
                key={i}
                r={r}
                rank={i + 1}
                highlightBest={highlightBest}
                selected={detail === r}
                t={t}
                onSelect={() => setSelectedRoute(r)}
                onStart={() => onStartConvoy(r)}
              />
            ))
          )}
        </div>

        <aside className="self-start overflow-hidden rounded-2xl border border-white/10 bg-black/15">
          {detail ? (
            <>
              <RouteMap from={detail.fromName ?? detail.fromLocation} to={detail.toName ?? detail.toLocation} />
              <div className="flex flex-col gap-3.5 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[18px] font-bold capitalize text-white">{detail.commodity}</div>
                    <div className="mt-0.5 text-[12px] text-white/45">
                      <span className="capitalize">{detail.fromName ?? detail.fromLocation}</span> → <span className="capitalize">{detail.toName ?? detail.toLocation}</span>
                      {detail.jumps != null ? ` · ${t("cargo.jumpsN", { n: detail.jumps })}` : ""}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[20px] font-semibold leading-none tabular-nums text-emerald-400">+{fmt(detail.profit)}</div>
                    <div className="mt-1 text-[10px] text-white/40">{fmt(detail.quantityScu)} SCU</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    [t("cargo.results.buy"), fmt(detail.buyPrice), false],
                    [t("cargo.results.sell"), fmt(detail.sellPrice), true],
                    [t("cargo.results.margin"), fmt(detail.marginUnit), false],
                    [t("cargo.results.time"), detail.timeMinutes != null ? `~${detail.timeMinutes.toFixed(0)} ${t("cargo.unit.min")}` : "—", false],
                  ] as const).map(([k, v, acc], i) => (
                    <div key={i} className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
                      <div className="text-[10px] uppercase tracking-wide text-white/40">{k}</div>
                      <div className={`mt-0.5 text-sm font-semibold tabular-nums ${acc ? "text-emerald-400" : "text-white/90"}`}>{v}</div>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => onStartConvoy(detail)}
                    className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-3 py-2.5 text-sm font-bold text-white hover:opacity-90"
                  >
                    {t("cargo.convoy.start")} <Play className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onLoadToHold(shipName, detail.commodity, detail.quantityScu)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-[13px] font-medium text-white/70 hover:bg-white/10"
                  >
                    <Box className="h-4 w-4" /> {t("cargo.tabGrid")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setModalRoute(detail)}
                    aria-label={t("cargo.results.detailsAria")}
                    className="grid h-[42px] w-[42px] place-items-center rounded-xl border border-white/10 bg-white/[0.03] text-white/60 hover:bg-white/10"
                  >
                    <PackageSearch className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex h-[300px] flex-col items-center justify-center gap-2 text-white/40">
              <Truck className="h-8 w-8 opacity-40" />
              <p className="text-sm">{t("cargo.results.empty")}</p>
            </div>
          )}
        </aside>
      </div>

      {modalRoute && <RouteDetailsModal route={modalRoute} onClose={() => setModalRoute(null)} />}
    </>
  );
}

/* ── Onglet : Planificateur de BOUCLE (chaîne de routes rentables) ── */

export { PlannerTab };
