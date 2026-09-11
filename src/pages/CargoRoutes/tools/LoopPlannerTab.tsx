import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { usePersistentState } from "../../../lib/uiPersist";
import { Loader2, ArrowRight, Truck, RotateCcw, RefreshCw, Infinity as InfinityIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { RouteDetailsModal } from "../../../components/RouteDetailsModal";
import Dropdown from "../../../components/ui/Dropdown";
import { type CargoRoute, type LoopResult, type CargoCtx } from "../types";
import { legToStep, pushOverlayRoute, fmt } from "../helpers";
import { RouteRow } from "../components/RouteRow";

function LoopPlannerTab({ ctx, onLoadToHold }: {
  ctx: CargoCtx;
  onLoadToHold: (shipName: string, commodity: string, scu: number) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // Vaisseau · budget · système · prix viennent du contexte partagé (barre de convoi).
  const { shipName, budget, system, prices } = ctx;

  const [commodities, setCommodities] = useState<string[]>([]);
  const [resource, setResource] = usePersistentState<string>("cargo.loop.resource", "");
  const [mode, setMode] = usePersistentState<"closed" | "open">("cargo.loop.mode", "closed");
  const [maxPoints, setMaxPoints] = usePersistentState<number>("cargo.loop.maxPoints", 4);
  const [unlimited, setUnlimited] = usePersistentState<boolean>("cargo.loop.unlimited", false);

  const [calculating, setCalculating] = useState(false);
  const [result, setResult] = useState<LoopResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedRoute, setSelectedRoute] = usePersistentState<CargoRoute | null>("cargo.loop.route", null);

  const hasPrices = (prices?.rows ?? 0) > 0;

  // Overlay en jeu : pousse la boucle calculée (toutes ses étapes).
  useEffect(() => {
    pushOverlayRoute(
      result && result.legs.length > 0
        ? { source: "loop", shipName, steps: result.legs.map(legToStep) }
        : null,
    );
  }, [result, shipName]);

  // Marchandises (le reste — vaisseau/prix — vient du contexte partagé).
  useEffect(() => {
    let alive = true;
    invoke<string[]>("get_cargo_commodities")
      .then((comms) => {
        if (!alive) return;
        setCommodities(comms);
        if (!resource && comms.length > 0) setResource(comms[0]);
      })
      .catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      {error && (
        <p className="mt-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      {/* Paramètres SPÉCIFIQUES à la boucle : ressource · mode · nb de points.
          Vaisseau · budget · système viennent du contexte de convoi partagé (barre du haut). */}
      <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <div className="grid gap-4 md:grid-cols-[1.2fr_1fr_1fr]">
          <label className="block">
            <span className="mb-1.5 block text-[11px] text-white/40">{t("cargo.loop.resource")}</span>
            <Dropdown
              value={resource}
              onChange={setResource}
              ariaLabel={t("cargo.loop.resource")}
              searchable
              options={commodities.map((c) => ({ value: c, label: c }))}
            />
          </label>
          <div>
            <span className="mb-1.5 block text-[11px] text-white/40">{t("cargo.loop.mode")}</span>
            <div className="grid grid-cols-2 gap-1 rounded-lg border border-white/10 p-1">
              {(["closed", "open"] as const).map((mk) => (
                <button
                  key={mk}
                  type="button"
                  onClick={() => setMode(mk)}
                  title={t(mk === "closed" ? "cargo.loop.modeClosedDesc" : "cargo.loop.modeOpenDesc")}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs font-medium transition-colors ${
                    mode === mk ? "bg-[var(--accent)] text-white" : "text-white/60 hover:bg-white/10"
                  }`}
                >
                  {mk === "closed" ? <RotateCcw className="h-3.5 w-3.5" /> : <ArrowRight className="h-3.5 w-3.5" />}
                  {t(mk === "closed" ? "cargo.loop.modeClosed" : "cargo.loop.modeOpen")}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="mb-1.5 block text-[11px] text-white/40">{t("cargo.loop.pointsMax")}</span>
            <div className="flex items-center gap-2.5">
              <input
                type="range"
                min={1}
                max={10}
                value={maxPoints}
                disabled={unlimited}
                onChange={(e) => setMaxPoints(Number(e.target.value))}
                className="min-w-0 flex-1 accent-[var(--accent)] disabled:opacity-40"
              />
              <span className="w-6 text-center text-lg font-medium tabular-nums text-[var(--accent)]">{unlimited ? "∞" : maxPoints}</span>
              <button
                type="button"
                onClick={() => setUnlimited((u) => !u)}
                title={t("cargo.loop.unlimited")}
                aria-pressed={unlimited}
                className={`grid h-8 w-8 flex-none place-items-center rounded-lg border transition-colors ${
                  unlimited ? "border-[var(--accent)]/45 bg-[var(--accent)]/[0.16] text-[var(--accent)]" : "border-white/10 text-white/50 hover:bg-white/10"
                }`}
              >
                <InfinityIcon className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => void calculate()}
            disabled={calculating || !hasPrices || !shipName}
            className="inline-flex items-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {calculating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {calculating ? t("cargo.form.calculating") : t("cargo.form.calculate")}
          </button>
          {!hasPrices && (
            <button type="button" onClick={() => navigate("/settings")} className="rounded-xl border border-[var(--accent)]/50 px-3 py-2.5 text-xs text-[var(--accent)] hover:bg-white/5">
              {t("cargo.empty.noPricesCta")}
            </button>
          )}
        </div>
      </div>

      {/* Résultat : étapes de la boucle (gauche) + bilan en tuiles (droite) */}
      <div className="mt-4">
        {!result ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/10 py-16 text-center text-white/40">
            <Truck className="h-8 w-8 opacity-40" />
            <p className="text-sm">{t("cargo.loop.resultsEmpty")}</p>
          </div>
        ) : result.legs.length === 0 ? (
          <p className="rounded-2xl border border-white/10 py-12 text-center text-sm text-white/50">
            {result.note ?? t(mode === "closed" ? "cargo.loop.emptyClosed" : "cargo.loop.emptyOpen")}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_300px]">
            <div className="flex min-w-0 flex-col gap-2.5">
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/45">
                {result.closed ? t("cargo.loop.closedRecap", { loc: result.startLocation }) : t("cargo.loop.openRecap", { loc: result.endLocation })}
              </span>
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
            <aside className="flex flex-col gap-3 self-start rounded-2xl border border-white/10 bg-black/15 p-4">
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/45">{t("cargo.loop.resultTitle")}</span>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5">
                  <div className="text-[10px] uppercase tracking-wide text-white/40">{t("cargo.loop.totalProfit")}</div>
                  <div className="mt-0.5 text-lg font-semibold tabular-nums text-emerald-400">+{fmt(result.totalProfit)}</div>
                </div>
                <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5">
                  <div className="text-[10px] uppercase tracking-wide text-white/40">{t("cargo.loop.totalTime")}</div>
                  <div className="mt-0.5 text-lg font-semibold tabular-nums text-white/90">{result.totalTimeMinutes != null ? `${result.totalTimeMinutes.toFixed(0)} ${t("cargo.unit.min")}` : "—"}</div>
                </div>
                <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5">
                  <div className="text-[10px] uppercase tracking-wide text-white/40">{t("cargo.loop.hops")}</div>
                  <div className="mt-0.5 text-lg font-semibold tabular-nums text-white/90">{result.hops}</div>
                </div>
                <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5">
                  <div className="text-[10px] uppercase tracking-wide text-white/40">{t("cargo.loop.legs")}</div>
                  <div className="mt-0.5 text-lg font-semibold tabular-nums text-white/90">{result.legs.length}</div>
                </div>
              </div>
            </aside>
          </div>
        )}
      </div>

      {selectedRoute && (
        <RouteDetailsModal route={selectedRoute} onClose={() => setSelectedRoute(null)} />
      )}
    </>
  );
}

/* ── Onglet : GPS trading (navigation pas-à-pas pilotée par l'utilisateur) ── */

export { LoopPlannerTab };
