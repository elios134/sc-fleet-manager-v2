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

export type TimelineEvent = {
  shipId: number;
  label: string;
  pct: number;
  tone: "bad" | "warn" | "ok";
  /** Nombre de vaisseaux réunis sous l'étiquette (les expirées sont regroupées en une seule). */
  count: number;
  /** Ancrage de l'étiquette, pour qu'elle reste dans le cadre aux deux extrémités. */
  anchor: "left" | "center" | "right";
};

const anchorOf = (pct: number): TimelineEvent["anchor"] => (pct < 4 ? "left" : pct > 85 ? "right" : "center");

export function timelineEvents(rows: InsuranceRow[], windowDays: number): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  const expired = rows.filter((r) => !r.lti && r.daysLeft != null && r.daysLeft < 0);
  if (expired.length > 0) {
    out.push({ shipId: expired[0].shipId, label: expired[0].name, pct: 0, tone: "bad", count: expired.length, anchor: "left" });
  }
  for (const r of rows) {
    if (r.lti || r.daysLeft == null || r.daysLeft < 0 || r.daysLeft > windowDays) continue;
    const pct = Math.min(100, Math.max(0, (r.daysLeft / windowDays) * 100));
    out.push({ shipId: r.shipId, label: r.name, pct, tone: r.daysLeft <= SOON_DAYS ? "warn" : "ok", count: 1, anchor: anchorOf(pct) });
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

/** État d'une carte, sur le même seuil que les filtres (statut WARNING = moins de 30 j). */
export function cardState(row: InsuranceRow): "lti" | "unknown" | "expired" | "soon" | "active" {
  if (row.lti) return "lti";
  if (row.daysLeft == null) return "unknown";
  if (row.status === "EXPIRED" || row.daysLeft < 0) return "expired";
  if (row.status === "WARNING") return "soon";
  return "active";
}
