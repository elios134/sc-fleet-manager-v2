/* Logique d'assurance partagée (réplique utils/insuranceAlert.ts V1).
 * Extraite de InsurancePage pour être réutilisée par le widget « Assurances »
 * du dashboard sans dupliquer la dérivation statut/jours. */

export type InsuranceShip = {
  id: number;
  name: string;
  manufacturer: string;
  lti: number;
  insuranceDuration: number | null;
  insuranceExpiry: string | null;
};

export type Status = "ok" | "warning" | "critical" | "expired";
export type UiStatus = "ACTIVE" | "WARNING" | "EXPIRED";

export type InsuranceRow = {
  shipId: number;
  name: string;
  manufacturer: string;
  lti: boolean;
  insuranceDuration: number | null;
  typeLabel: string;
  expiryLabel: string;
  status: UiStatus;
  daysLeft: number | null;
  expiryIso: string | null;
};

export function getInsuranceStatus(expiry: Date | null): Status {
  if (!expiry) return "ok";
  const days = Math.floor((expiry.getTime() - Date.now()) / 86_400_000);
  if (days < 0) return "expired";
  if (days < 7) return "critical";
  if (days < 30) return "warning";
  return "ok";
}

export function getInsuranceDaysLeft(expiry: Date | null): number | null {
  if (!expiry) return null;
  return Math.floor((expiry.getTime() - Date.now()) / 86_400_000);
}

export function formatInsuranceType(lti: boolean, months: number | null): string {
  if (lti) return "LTI";
  if (months != null) return `SHI (${months}M)`;
  return "SHI";
}

export function addMonths(base: Date, n: number): Date {
  const d = new Date(base);
  d.setMonth(d.getMonth() + n);
  return d;
}

export function uiStatusFrom(status: Status, daysLeft: number | null): UiStatus {
  if (status === "expired") return "EXPIRED";
  if (status === "ok") return "ACTIVE";
  if (daysLeft !== null && daysLeft < 30) return "WARNING";
  return "ACTIVE";
}

export function formatExpiryLabel(s: InsuranceShip): string {
  if (s.lti === 1) return "";
  if (!s.insuranceExpiry) return "—";
  const t = new Date(s.insuranceExpiry).getTime();
  if (!Number.isFinite(t)) return "—";
  return new Date(t).toISOString().slice(0, 10);
}

export function buildInsuranceRow(s: InsuranceShip): InsuranceRow {
  const lti = s.lti === 1;
  const expiryIso = s.insuranceExpiry ?? null;
  const expiryDate = expiryIso ? new Date(expiryIso) : null;
  const status = getInsuranceStatus(expiryDate);
  const daysLeft = getInsuranceDaysLeft(expiryDate);
  return {
    shipId: s.id,
    name: s.name,
    manufacturer: s.manufacturer,
    lti,
    insuranceDuration: s.insuranceDuration ?? null,
    typeLabel: formatInsuranceType(lti, s.insuranceDuration ?? null),
    expiryLabel: formatExpiryLabel(s),
    status: uiStatusFrom(status, daysLeft),
    daysLeft,
    expiryIso,
  };
}

/** Tri par urgence : EXPIRED puis WARNING puis ACTIVE, puis par expiration la plus proche. */
export function sortByUrgency(rows: InsuranceRow[]): InsuranceRow[] {
  const rank = (s: UiStatus) => (s === "EXPIRED" ? 0 : s === "WARNING" ? 1 : 2);
  return [...rows].sort((a, b) => {
    const r = rank(a.status) - rank(b.status);
    if (r !== 0) return r;
    const ta = a.expiryIso ? new Date(a.expiryIso).getTime() : Number.POSITIVE_INFINITY;
    const tb = b.expiryIso ? new Date(b.expiryIso).getTime() : Number.POSITIVE_INFINITY;
    return ta - tb;
  });
}
