import { type TFunction } from "i18next";
import { buildInsuranceRow, sortByUrgency, type InsuranceShip, type UiStatus } from "../../../lib/insurance";

/* ── Assurances : 3 lignes les plus urgentes ── */

const INS_COLOR: Record<UiStatus, string> = {
  ACTIVE: "#34d399",
  WARNING: "#fbbf24",
  EXPIRED: "#f87171",
};

function InsuranceBody({ ships, t }: { ships: InsuranceShip[]; t: TFunction }) {
  const rows = sortByUrgency(ships.map(buildInsuranceRow)).slice(0, 3);
  if (rows.length === 0) {
    return (
      <div className="flex min-h-[120px] items-center justify-center text-xs text-white/40">
        {t("dashboard.wInsuranceNone")}
      </div>
    );
  }
  return (
    <div>
      {rows.map((r) => {
        const color = r.lti ? INS_COLOR.ACTIVE : INS_COLOR[r.status];
        const label = r.lti
          ? t("dashboard.wInsuranceLti")
          : r.daysLeft != null && r.daysLeft < 0
            ? t("dashboard.wNextExpired")
            : r.daysLeft != null
              ? t("dashboard.dMinus", { days: r.daysLeft })
              : r.expiryLabel;
        return (
          <div
            key={r.shipId}
            className="flex items-center justify-between border-b border-white/5 py-2 last:border-0"
          >
            <div className="flex min-w-0 items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
              <div className="min-w-0">
                <div className="truncate text-[13px] text-white">{r.name}</div>
                <div className="truncate text-[10px] text-white/40">{r.manufacturer}</div>
              </div>
            </div>
            <span className="shrink-0 text-xs font-semibold" style={{ color }}>
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export { InsuranceBody };
