import { Loader2, PackageSearch, ChevronDown } from "lucide-react";
import Dropdown from "../../../components/ui/Dropdown";
import { SYSTEMS } from "../helpers";
import { Field } from "../components/Field";
import type { GpsTrip } from "./useGpsTrip";

/** Panneau Paramètres du GPS : vaisseau, système, chargement du graphe, départ. */
export function GpsParams({ gps }: { gps: GpsTrip }) {
  const {
    t,
    navigate,
    shipName,
    setShipName,
    system,
    setSystem,
    ships,
    loadingGraph,
    graph,
    startKey,
    setStartKey,
    paramsOpen,
    setParamsOpen,
    setSteps,
    setExpanded,
    detectedLocation,
    hasPrices,
    loadGraph,
    detectedMatch,
  } = gps;
  return (
    <>
        <div className="rounded-2xl glass p-5">
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
                  onClick={() => navigate("/settings#donnees")}
                  className="mt-3 w-full rounded-lg border border-[var(--accent)]/50 px-3 py-2 text-xs text-[var(--accent)] hover:bg-white/5"
                >
                  {t("cargo.empty.noPricesCta")}
                </button>
              )}
            </>
          </>
          )}
        </div>
    </>
  );
}
