// Logique pure de l'accueil : alertes à traiter, état de session, objets les plus nombreux.
import type { InsuranceRow } from "../../lib/insurance";
import { isGameActive } from "../../components/background/animate";
import type { Journal, RsiServerStatus } from "./useHomeData";

export type AlertKind = "insuranceExpired" | "insuranceSoon" | "translationUpdate" | "uexStale" | "gamelogOff";
export type Alert = {
  kind: AlertKind;
  severity: "bad" | "warn" | "info";
  titleKey: string;
  params: Record<string, string | number>;
  to: string;
};

const SOON_DAYS = 15;
const UEX_STALE_HOURS = 24;
const RANK = { bad: 0, warn: 1, info: 2 } as const;

export function deriveAlerts(i: {
  insurance: InsuranceRow[];
  channels: { label: string; install: { updateAvailable: boolean } | null }[];
  uexAgeHours: number | null;
  gamelogEnabled: boolean;
  gamelogPathExists: boolean;
}): Alert[] {
  const out: Alert[] = [];
  for (const r of i.insurance) {
    if (r.lti || r.daysLeft == null) continue;
    if (r.daysLeft < 0) {
      out.push({ kind: "insuranceExpired", severity: "bad", titleKey: "home.alert.insuranceExpired", params: { ship: r.name, days: -r.daysLeft }, to: "/fleet/assurances" });
    } else if (r.daysLeft <= SOON_DAYS) {
      out.push({ kind: "insuranceSoon", severity: "warn", titleKey: "home.alert.insuranceSoon", params: { ship: r.name, days: r.daysLeft }, to: "/fleet/assurances" });
    }
  }
  for (const c of i.channels) {
    if (c.install?.updateAvailable) {
      out.push({ kind: "translationUpdate", severity: "warn", titleKey: "home.alert.translationUpdate", params: { channel: c.label }, to: "/tools/traduction" });
    }
  }
  if (i.uexAgeHours != null && i.uexAgeHours > UEX_STALE_HOURS) {
    out.push({ kind: "uexStale", severity: "info", titleKey: "home.alert.uexStale", params: { hours: Math.round(i.uexAgeHours) }, to: "/commerce/cargo" });
  }
  if (!i.gamelogEnabled && i.gamelogPathExists) {
    out.push({ kind: "gamelogOff", severity: "info", titleKey: "home.alert.gamelogOff", params: {}, to: "/settings" });
  }
  return out.sort((a, b) => RANK[a.severity] - RANK[b.severity]);
}

export function sessionState(
  logAgeSecs: number | null,
  lastSessionIso: string | null,
  now: Date,
): { kind: "live" } | { kind: "offline"; sinceMinutes: number | null } {
  if (isGameActive(logAgeSecs)) return { kind: "live" };
  if (!lastSessionIso) return { kind: "offline", sinceMinutes: null };
  const t = Date.parse(lastSessionIso);
  if (Number.isNaN(t)) return { kind: "offline", sinceMinutes: null };
  return { kind: "offline", sinceMinutes: Math.max(0, Math.round((now.getTime() - t) / 60_000)) };
}

export function topItems(
  possessions: Record<string, Record<string, { qte: number }>>,
  n: number,
): { classe: string; qte: number }[] {
  const sum: Record<string, number> = {};
  for (const inv of Object.values(possessions)) {
    for (const [classe, s] of Object.entries(inv)) sum[classe] = (sum[classe] ?? 0) + s.qte;
  }
  return Object.entries(sum)
    .map(([classe, qte]) => ({ classe, qte }))
    .filter((x) => x.qte > 0)
    .sort((a, b) => b.qte - a.qte)
    .slice(0, n);
}

/** Arrivée depuis la première connexion RSI (StartPage) → déclenche l'onboarding. */
export function isFirstLogin(state: unknown): boolean {
  return typeof state === "object" && state !== null && (state as { firstLogin?: unknown }).firstLogin === true;
}

/** Le carnet n'a rien à montrer tant que le Game.log n'a produit ni session, ni dépense, ni mission. */
export function hasLogbook(j: Journal | null): boolean {
  return !!j && (j.lastSession != null || j.spendingTotal > 0 || j.missions.completed > 0);
}

/** Hors-ligne, le statut RSI revient sans composant : rien à afficher. */
export function hasServers(s: RsiServerStatus | null): boolean {
  return !!s && s.components.length > 0;
}

/** « Hors jeu depuis » : minutes sous 1 h, heures sous 1 jour, puis jours. */
export function sinceLabel(minutes: number): { key: string; n: number } {
  if (minutes < 60) return { key: "home.offlineSince", n: minutes };
  if (minutes < 1440) return { key: "home.offlineSinceH", n: Math.floor(minutes / 60) };
  return { key: "home.offlineSinceD", n: Math.floor(minutes / 1440) };
}
