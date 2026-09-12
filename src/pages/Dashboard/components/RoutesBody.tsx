import { useNavigate } from "react-router";
import { type TFunction } from "i18next";
import { ArrowRight } from "lucide-react";
import { type TopRoutesResult } from "../types";
import { formatAuec } from "../helpers";

/* ── Top routes rentables : top 3 par profit/min (plus gros cargo du compte actif) ── */

function RoutesBody({
  result,
  t,
  editing,
  navigate,
}: {
  result: TopRoutesResult | null;
  t: TFunction;
  editing: boolean;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const routes = result?.routes ?? [];
  if (routes.length === 0) {
    return (
      <div className="flex min-h-[120px] items-center justify-center px-3 text-center text-xs text-white/40">
        {t("dashboard.wRoutesNone")}
      </div>
    );
  }
  const shipName = result?.shipName ?? "";
  return (
    <div>
      {routes.slice(0, 3).map((r, i) => (
        <div
          key={i}
          // Clic sur une route → ouvre le planificateur DIRECTEMENT sur cette route
          // (vaisseau + identité de la route en state). stopPropagation : n'enchaîne pas
          // sur le clic « général » de la carte. Hors édition (priorité au drag).
          onClick={
            editing
              ? undefined
              : (e) => {
                  e.stopPropagation();
                  navigate("/cargo-routes", {
                    state: {
                      route: {
                        shipName,
                        commodity: r.commodity,
                        fromLocation: r.fromLocation,
                        toLocation: r.toLocation,
                      },
                    },
                  });
                }
          }
          className={`border-b border-white/5 py-2 last:border-0 ${
            editing ? "" : "cursor-pointer transition-colors hover:bg-white/[0.03]"
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-[13px] font-medium text-white">
              {r.commodity}
            </span>
            <span className="shrink-0 text-[11px] font-semibold text-[#5dcaa5]">
              {r.profitPerMinute != null
                ? t("dashboard.wRoutesPerMin", { amount: formatAuec(r.profitPerMinute) })
                : t("dashboard.aUec", { amount: formatAuec(r.profit) })}
            </span>
          </div>
          <div className="mt-0.5 flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1 text-[11px] text-white/40">
              <span className="truncate">{r.fromLocation}</span>
              <ArrowRight className="h-3 w-3 shrink-0" />
              <span className="truncate">{r.toLocation}</span>
            </span>
            <span className="shrink-0 text-[10px] text-white/30">
              {t("dashboard.wRoutesTotal", { amount: formatAuec(r.profit) })}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

export { RoutesBody };
