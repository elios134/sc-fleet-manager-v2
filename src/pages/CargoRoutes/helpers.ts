import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { type TFunction } from "i18next";
import { type CargoRoute, type OverlayStep, type OverlayRoute, type RouteSort } from "./types";

function legToStep(leg: CargoRoute): OverlayStep {
  return {
    from: leg.fromName ?? leg.fromLocation,
    to: leg.toName ?? leg.toLocation,
    commodity: leg.commodity,
    profit: leg.profit,
    scu: leg.quantityScu ?? undefined,
    minutes: leg.timeMinutes ?? undefined,
    jumps: leg.jumps ?? undefined,
    fuel: leg.fuelScu ?? undefined,
    distanceGm: leg.distanceGm ?? undefined,
  };
}

function pushOverlayRoute(route: OverlayRoute) {
  void invoke("set_app_meta", { key: "overlay.nav", value: JSON.stringify(route) }).catch(() => {});
  void emit("overlay:nav", route).catch(() => {});
}

const SYSTEMS = ["stanton", "pyro", "nyx"] as const;

/* ── Helpers ── */

function fmt(n: number): string {
  return Math.round(n).toLocaleString("fr-FR");
}

function relativeAge(iso: string | null, t: TFunction): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const mins = Math.max(0, Math.floor((Date.now() - then) / 60000));
  if (mins < 60) return t("cargo.ageMinutes", { n: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 48) return t("cargo.ageHours", { n: hours });
  return t("cargo.ageDays", { n: Math.floor(hours / 24) });
}
// Prix frais (< 60 min) → pastille verte, sinon ambre. null = timestamp absent/invalide.

function priceFresh(iso: string | null): boolean | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return (Date.now() - then) / 60000 < 60;
}
// Tri des routes : profit (défaut), rentabilité (profit/min), temps (croissant).

function sortRoutes(routes: CargoRoute[], key: RouteSort): CargoRoute[] {
  const s = [...routes];
  if (key === "ppm") s.sort((a, b) => (b.profitPerMinute ?? -Infinity) - (a.profitPerMinute ?? -Infinity));
  else if (key === "time") s.sort((a, b) => (a.timeMinutes ?? Infinity) - (b.timeMinutes ?? Infinity));
  else s.sort((a, b) => b.profit - a.profit);
  return s;
}

/* ══════════════════════════ COCKPIT DE CONVOI ══════════════════════════ */
// Contexte de convoi PARTAGÉ : vaisseau · départ · budget, définis une fois et pilotant
// les outils. Remonté au wrapper CargoRoutesPage et passé aux outils.

export { legToStep, pushOverlayRoute, SYSTEMS, fmt, relativeAge, priceFresh, sortRoutes };
