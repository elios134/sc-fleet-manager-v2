import type { ShipRow } from "./types";

export function formatUsd(value: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatPriceUsd(price: number | null): string {
  return price != null && price > 0 ? `${Math.round(price).toLocaleString("en-US")} $` : "—";
}

// Rang d'assurance croissant (0 = meilleur) : LTI d'abord, puis plus de mois, inconnu en dernier.
export function shipInsRank(s: ShipRow): number {
  if (s.lti === 1) return 0;
  if (s.insuranceDuration == null) return 9999;
  return 1000 - s.insuranceDuration;
}

// Jours restants avant expiration (SQLite datetime UTC « YYYY-MM-DD HH:MM:SS »).
export function rentalDaysLeft(expiresAt: string | null): number | null {
  if (!expiresAt) return null;
  const iso = expiresAt.includes("T") ? expiresAt : `${expiresAt.replace(" ", "T")}Z`;
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  return Math.ceil(ms / 86_400_000);
}
