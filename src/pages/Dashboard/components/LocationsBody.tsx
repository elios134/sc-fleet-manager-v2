import { type TFunction } from "i18next";
import { rentalDaysLeft } from "../../../components/ShipCard";
import { type RentedShip } from "../types";

/* ── Locations qui expirent : top 3 loués par échéance (compte actif) ── */

function LocationsBody({ ships, t }: { ships: RentedShip[]; t: TFunction }) {
  const rows = ships.slice(0, 3);
  if (rows.length === 0) {
    return (
      <div className="flex min-h-[72px] items-center justify-center text-xs text-white/40">
        {t("dashboard.wLocationsNone")}
      </div>
    );
  }
  return (
    <div>
      {rows.map((s) => {
        const d = rentalDaysLeft(s.rentalExpiresAt);
        const expired = d != null && d <= 0;
        // Couleur badge (comme ShipCard) : expiré rouge, ≤3 j ambre, sinon vert.
        const color = expired ? "#f87171" : d != null && d <= 3 ? "#fbbf24" : "#34d399";
        const label =
          d == null
            ? "—"
            : expired
              ? t("dashboard.wLocationsExpired")
              : t("dashboard.wLocationsIn", { days: d });
        return (
          <div
            key={s.id}
            className="flex items-center justify-between border-b border-white/5 py-2 last:border-0"
          >
            <span className="min-w-0 truncate text-[13px] text-white">{s.name}</span>
            <span className="shrink-0 text-xs font-semibold" style={{ color }}>
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export { LocationsBody };
