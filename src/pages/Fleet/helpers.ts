import { Shield, ShieldCheck, ShieldAlert, type LucideIcon } from "lucide-react";
import type { TFunction } from "i18next";
import type { ShipRow } from "./types";

export function formatUsd(value: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatPriceUsd(price: number): string {
  return `${Math.round(price).toLocaleString("en-US")} $`;
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

/* ── Assurance : pastille (icône + libellé + teinte) ── */
type InsuranceTier = "lifetime" | "yellow" | "red";
const TIER: Record<InsuranceTier, { color: string; bg: string; border: string; icon: LucideIcon }> = {
  lifetime: { color: "#2ee9a5", bg: "rgba(46,233,165,0.18)", border: "rgba(46,233,165,0.35)", icon: ShieldCheck },
  yellow: { color: "#ffcf7a", bg: "rgba(245,158,11,0.18)", border: "rgba(245,158,11,0.32)", icon: Shield },
  red: { color: "#ff9a9a", bg: "rgba(242,109,109,0.22)", border: "rgba(242,109,109,0.4)", icon: ShieldAlert },
};

export function insuranceBadge(s: ShipRow, t: TFunction) {
  const isLti = s.lti === 1;
  const tierKey: InsuranceTier = isLti ? "lifetime" : s.insuranceDuration == null || s.insuranceDuration < 6 ? "red" : "yellow";
  const tier = TIER[tierKey];
  const label = isLti
    ? t("shipCard.insuranceLifetime")
    : s.insuranceDuration == null
      ? t("shipCard.insuranceUnknown")
      : t("shipCard.insuranceMonths", { n: s.insuranceDuration });
  return { ...tier, label };
}

// Badge d'acquisition : acheté / loué (compte à rebours). 'rsi' = pas de badge.
export function acqBadge(s: ShipRow, t: TFunction): { label: string; color: string; bg: string } | null {
  if (s.acquisition === "bought") return { label: t("shipCard.acqBought"), color: "#c7cbff", bg: "rgba(99,102,241,0.28)" };
  if (s.acquisition === "rented") {
    const daysLeft = rentalDaysLeft(s.rentalExpiresAt);
    if (daysLeft != null && daysLeft <= 0) return { label: t("shipCard.acqRentedExpired"), color: "#ff9a9a", bg: "rgba(242,109,109,0.24)" };
    return { label: t("shipCard.acqRentedExpiresIn", { days: daysLeft ?? 0 }), color: "#ffd591", bg: "rgba(245,158,11,0.24)" };
  }
  return null;
}
