import { useTranslation } from "react-i18next";
import { formatUsd } from "../helpers";
import { fleetKpis } from "../lib/fleetView";
import type { FleetStats, ShipRow } from "../types";

/* Bandeau de chiffres de la flotte : vaisseaux, valeur (prix RSI), cargo, équipage, assurances
   courtes (< 12 mois, hors LTI et locations) — la dernière en ambre quand il y en a. */
export function FleetKpis({ ships, stats }: { ships: ShipRow[]; stats: FleetStats | null }) {
  const { t } = useTranslation();
  const k = fleetKpis(ships);
  const tiles: Array<[string, string, boolean]> = [
    [t("fleet.statShips"), String(k.count), false],
    [t("fleet.statTotalValue2"), stats ? formatUsd(stats.totalFleetValueUsd) : "—", false],
    [t("fleet.kpiCargo"), `${k.cargo.toLocaleString("fr-FR")} SCU`, false],
    [t("fleet.kpiCrew"), String(k.crew), false],
    [t("fleet.kpiShortInsurance"), String(k.shortInsurance), k.shortInsurance > 0],
  ];
  return (
    <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
      {tiles.map(([label, value, warn]) => (
        <div key={label} className="glass rounded-2xl px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-white/40">{label}</p>
          <p className={`mt-0.5 text-[20px] font-bold tabular-nums ${warn ? "text-[var(--amber)]" : "text-white"}`}>{value}</p>
        </div>
      ))}
    </div>
  );
}
