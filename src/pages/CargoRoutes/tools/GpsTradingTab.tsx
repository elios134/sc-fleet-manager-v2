import { RouteDetailsModal } from "../../../components/RouteDetailsModal";
import { TripMapModal } from "../../../components/TripMapModal";
import { type CargoCtx } from "../types";
import { relativeAge } from "../helpers";
import { useGpsTrip } from "./useGpsTrip";
import { GpsParams } from "./GpsParams";
import { GpsNavigation } from "./GpsNavigation";

function GpsTradingTab({ ctx, onLoadToHold }: {
  ctx: CargoCtx;
  onLoadToHold: (shipName: string, commodity: string, scu: number) => void;
}) {
  const gps = useGpsTrip(ctx);
  const {
    t,
    prices,
    graph,
    error,
    startKey,
    steps,
    selectedRoute,
    setSelectedRoute,
    showMap,
    setShowMap,
    hasPrices,
  } = gps;
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
        <GpsParams gps={gps} />

        <GpsNavigation gps={gps} onLoadToHold={onLoadToHold} />
      </div>

      {selectedRoute && <RouteDetailsModal route={selectedRoute} onClose={() => setSelectedRoute(null)} />}
      {showMap && graph && startKey && (
        <TripMapModal steps={steps} startKey={startKey} graph={graph} onClose={() => setShowMap(false)} />
      )}
    </>
  );
}

export { GpsTradingTab };

