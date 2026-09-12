// Logique pure du work order minier : valeur au scan, évaluation des 9 méthodes de
// raffinage (rendement/coût/temps/profit), classement. Aucune I/O — testé en isolation.

import {
  METHODS,
  FALLBACK_SELL,
  REFINE_COST_PER_SCU,
  REFINE_SECS_PER_SCU,
  mineralByKey,
} from "../../lib/miningRegistry";
import type { OreLine, SellPoint, MethodResult, RefinerySellRow } from "./types";

/** Indexe les lignes Rust (par commodity) → meilleur SellPoint par clé minéral. */
export function toSellPoints(rows: RefinerySellRow[]): Record<string, SellPoint> {
  const byCommodity: Record<string, RefinerySellRow> = {};
  for (const r of rows) {
    const prev = byCommodity[r.commodityName];
    if (!prev || r.priceSell > prev.priceSell) byCommodity[r.commodityName] = r;
  }
  const out: Record<string, SellPoint> = {};
  for (const m of Object.values(mineralByKey)) {
    const r = byCommodity[m.commodity];
    if (r && r.priceSell > 0) {
      out[m.key] = {
        mineral: m.key,
        terminal: r.terminal,
        system: r.system,
        priceSell: r.priceSell,
        scuDemand: r.scuDemand,
        updatedAt: r.updatedAt,
        live: true,
      };
    }
  }
  return out;
}

/** Prix de vente d'un minéral : UEX live si dispo, sinon repli statique. */
export function priceOf(key: string, sells: Record<string, SellPoint>): number {
  const live = sells[key];
  if (live) return live.priceSell;
  return FALLBACK_SELL[key] ?? 0;
}

/** Lignes de brut valides (minéral connu, quantité > 0). */
export function cleanOre(ore: OreLine[]): OreLine[] {
  return ore.filter((o) => o.scu > 0 && mineralByKey[o.key]);
}

/** Valeur théorique « au scan » (brut non raffiné, prix raffiné plein). */
export function scanValue(ore: OreLine[], sells: Record<string, SellPoint>): number {
  return cleanOre(ore).reduce((s, o) => s + o.scu * priceOf(o.key, sells), 0);
}

/** Total de brut (SCU). */
export function totalScu(ore: OreLine[]): number {
  return cleanOre(ore).reduce((s, o) => s + o.scu, 0);
}

/** Évalue une méthode de raffinage sur le brut. */
export function evalMethod(
  ore: OreLine[],
  methodKey: string,
  sells: Record<string, SellPoint>,
): MethodResult | null {
  const method = METHODS.find((m) => m.key === methodKey);
  if (!method) return null;
  const lines = cleanOre(ore);
  const raw = totalScu(lines);
  let refinedScu = 0;
  let revenue = 0;
  for (const o of lines) {
    const refined = o.scu * method.yieldMult;
    refinedScu += refined;
    revenue += refined * priceOf(o.key, sells);
  }
  const cost = raw * REFINE_COST_PER_SCU * method.costMult;
  const durationSecs = raw * REFINE_SECS_PER_SCU * method.durationMult;
  const net = revenue - cost;
  const netPerHour = durationSecs > 0 ? net / (durationSecs / 3600) : 0;
  return { key: method.key, name: method.name, refinedScu, revenue, cost, net, durationSecs, netPerHour };
}

/** Classe les 9 méthodes par critère (`net` = profit, `netPerHour` = rendement horaire). */
export function rankMethods(
  ore: OreLine[],
  sells: Record<string, SellPoint>,
  by: "net" | "netPerHour" = "net",
): MethodResult[] {
  return METHODS.map((m) => evalMethod(ore, m.key, sells))
    .filter((r): r is MethodResult => r != null)
    .sort((a, b) => b[by] - a[by]);
}

/** Formate une durée en `Xh YYm` / `Ym`. */
export function fmtDur(secs: number): string {
  const s = Math.max(0, Math.round(secs));
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

/** Âge relatif d'un prix (« il y a 3h ») depuis un ISO ; null → « — ». */
export function freshness(iso: string | null): string {
  if (!iso) return "—";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "—";
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 60) return `il y a ${mins} min`;
  const h = Math.round(mins / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.round(h / 24);
  return `il y a ${d} j`;
}
