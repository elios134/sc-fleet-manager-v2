import { type WidgetDef, type CcuShip, type CcuSuggestion } from "./types";
import { COL_W, GAP, WIDTH_1, WIDTH_2, ROW_H } from "./widgets";

function widthOf(def: WidgetDef): number {
  return def.span === 2 ? WIDTH_2 : WIDTH_1;
}

function defaultPos(index: number): { x: number; y: number } {
  const perRow = 4;
  return {
    x: (index % perRow) * (COL_W + GAP),
    y: Math.floor(index / perRow) * ROW_H,
  };
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function formatAuec(amount: number): string {
  return amount.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function computeCcuSuggestion(ships: CcuShip[]): CcuSuggestion | null {
  // « Depuis » = vaisseau possédé au priceCents le plus élevé.
  const owned = ships.filter((s) => s.isOwned && s.priceCents != null);
  if (owned.length === 0) return null;
  const from = owned.reduce((a, b) => ((b.priceCents ?? 0) > (a.priceCents ?? 0) ? b : a));

  // « Cible » = vaisseau CCU-able au priceCents immédiatement supérieur.
  const fromPrice = from.priceCents ?? 0;
  const targets = ships.filter(
    (s) => s.priceSource === "ccu" && s.priceCents != null && s.priceCents > fromPrice,
  );
  if (targets.length === 0) return null;
  const to = targets.reduce((a, b) =>
    (b.priceCents ?? Infinity) < (a.priceCents ?? Infinity) ? b : a,
  );

  return { from, to, delta: (to.priceCents ?? 0) - fromPrice };
}

export { widthOf, defaultPos, formatCents, formatAuec, computeCcuSuggestion };
