import { type TFunction } from "i18next";
import { type CcuShip } from "./types";

// Multiplicateur TTC appliqué à l'AFFICHAGE seulement (1 = prix HT bruts de l'API RSI).
// Mis à jour à chaque rendu depuis l'état `vatRate` du composant : fmtMoney/fmtMoneyDelta
// — et les helpers de copie qui les réutilisent — lisent ce module-level pour rester
// cohérents sans prop-drilling (cette page est l'unique consommatrice). Objet mutable
// (et non `let`) pour rester réassignable depuis l'index via une const importée.
const displayTaxMultiplier = { mult: 1 };

/** Clé AppMeta du taux de TVA d'affichage (partageable avec d'autres pages prix). */
const VAT_RATE_META_KEY = "pricing.vatRate";

function fmtMoney(cents: number): string {
  return `$${((cents * displayTaxMultiplier.mult) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

/** Delta signé, ex. « +$23 » / « -$73 ». */
function fmtMoneyDelta(cents: number): string {
  const sign = cents < 0 ? "-" : "+";
  return `${sign}${fmtMoney(Math.abs(cents))}`;
}

/** Pourcentage d'une référence, ex. (-7300, 76000) → « -9.6% ». Référence nulle → « ». */
function fmtPct(part: number, whole: number | null): string {
  if (whole === null || whole === 0) return "";
  const rounded = Math.round((part / whole) * 1000) / 10;
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// lastSyncAt = datetime('now') SQLite (UTC, « YYYY-MM-DD HH:MM:SS ») → parser en UTC.
function parseSyncMs(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso.replace(" ", "T") + "Z").getTime();
  return Number.isNaN(t) ? null : t;
}

/** Âge relatif : « jamais » / « à l'instant » / « il y a {n} min/h/j ». */
function relativeAge(iso: string | null, t: TFunction): string {
  const ms = parseSyncMs(iso);
  if (ms === null) return t("ccu.never");
  const mins = Math.floor((Date.now() - ms) / 60000);
  if (mins < 1) return t("ccu.justNow");
  if (mins < 60) return t("ccu.minsAgo", { count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t("ccu.hoursAgo", { count: hours });
  return t("ccu.daysAgo", { count: Math.floor(hours / 24) });
}

/* ── Carte de résultat dépliable (calquée V1 PathCard) ── */

function shipName(shipsById: Map<number, CcuShip>, id: number): string {
  return shipsById.get(id)?.name ?? `Ship #${id}`;
}

export { displayTaxMultiplier, VAT_RATE_META_KEY, fmtMoney, fmtMoneyDelta, fmtPct, SEVEN_DAYS_MS, parseSyncMs, relativeAge, shipName };
