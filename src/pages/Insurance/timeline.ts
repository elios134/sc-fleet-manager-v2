// Compteurs, frise des échéances et jauge de temps restant (logique pure, testée).
import type { InsuranceRow } from "../../lib/insurance";

const SOON_DAYS = 15;
const DAYS_PER_MONTH = 30.44;

export function kpis(rows: InsuranceRow[]): { covered: number; lti: number; soon: number; expired: number; nextDays: number | null } {
  const future = rows.filter((r) => !r.lti && r.daysLeft != null && r.daysLeft >= 0).map((r) => r.daysLeft!);
  return {
    covered: rows.length,
    lti: rows.filter((r) => r.lti).length,
    soon: future.filter((d) => d <= SOON_DAYS).length,
    expired: rows.filter((r) => !r.lti && r.daysLeft != null && r.daysLeft < 0).length,
    nextDays: future.length ? Math.min(...future) : null,
  };
}

export function timelineEvents(
  rows: InsuranceRow[],
  windowDays: number,
): { shipId: number; label: string; pct: number; tone: "bad" | "warn" | "ok" }[] {
  const out: { shipId: number; label: string; pct: number; tone: "bad" | "warn" | "ok" }[] = [];
  for (const r of rows) {
    if (r.lti || r.daysLeft == null) continue;
    if (r.daysLeft < 0) out.push({ shipId: r.shipId, label: r.name, pct: 0, tone: "bad" });
    else if (r.daysLeft <= windowDays) {
      const pct = Math.min(100, Math.max(0, (r.daysLeft / windowDays) * 100));
      out.push({ shipId: r.shipId, label: r.name, pct, tone: r.daysLeft <= SOON_DAYS ? "warn" : "ok" });
    }
  }
  return out.sort((a, b) => a.pct - b.pct);
}

/** Segments allumés (sur n) : part de la durée d'assurance restante ; LTI / expirée = jauge pleine. */
export function segmentsFilled(row: InsuranceRow, n: number): number {
  if (row.lti) return n;
  if (row.daysLeft == null) return 0;
  if (row.daysLeft < 0) return n;
  if (!row.insuranceDuration) return 0;
  const frac = row.daysLeft / (row.insuranceDuration * DAYS_PER_MONTH);
  return Math.min(n, Math.max(0, Math.round(frac * n)));
}
