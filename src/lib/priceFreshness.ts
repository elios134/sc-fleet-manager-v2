import { type TFunction } from "i18next";

// Âge d'un prix UEX à partir de son `dateModified` (epoch UEX — secondes, parfois ms).
// Renvoie un libellé relatif localisé + un flag « frais » (≤ 2 j → vert, sinon ambre).
// null si l'horodatage est absent/invalide (→ pas de pastille).

export type PriceAge = { label: string; fresh: boolean };

const FRESH_MAX_HOURS = 48; // marché items UEX : moins volatil que les commodités

export function priceFreshness(dateModified: number | null | undefined, t: TFunction): PriceAge | null {
  if (dateModified == null || !Number.isFinite(dateModified) || dateModified <= 0) return null;
  const ms = dateModified > 1e12 ? dateModified : dateModified * 1000; // s → ms si nécessaire
  const diffMs = Date.now() - ms;
  if (!Number.isFinite(diffMs) || diffMs < 0) return null;
  const mins = Math.floor(diffMs / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  const fresh = hours <= FRESH_MAX_HOURS;
  let label: string;
  if (mins < 60) label = t("catalogue.ageMinutes", { n: Math.max(1, mins) });
  else if (hours < 48) label = t("catalogue.ageHours", { n: hours });
  else label = t("catalogue.ageDays", { n: days });
  return { label, fresh };
}
