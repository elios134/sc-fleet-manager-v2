import { PackageSearch, ArrowRight, Truck, Fuel } from "lucide-react";
import { fmt } from "../helpers";
import { AffluenceBadge } from "../components/AffluenceBadge";
import { FuelBadge } from "../components/FuelBadge";
import type { GpsTrip } from "./useGpsTrip";

/** Navigation du GPS : trajet confirmé (fil d'Ariane, carburant) + carrefour courant. */
export function GpsNavigation({ gps, onLoadToHold }: { gps: GpsTrip, onLoadToHold: (shipName: string, commodity: string, scu: number) => void }) {
  const {
    t,
    shipName,
    graph,
    startKey,
    steps,
    expanded,
    setExpanded,
    setSelectedRoute,
    setShowMap,
    resetTrip,
    cumulProfit,
    cumulTime,
    rangeGm,
    tankScu,
    hasFuelData,
    cumulDist,
    cumulFuel,
    overRange,
    refuelAtStep,
    legUnreachable,
    crumbs,
    currentName,
    goToCrumb,
    confirmLeg,
    rows,
  } = gps;
  return (
    <>
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
          <div className="rounded-2xl glass p-5">
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
    </>
  );
}
