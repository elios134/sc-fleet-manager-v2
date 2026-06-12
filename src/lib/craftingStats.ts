// Math des stats de craft réactives — port fidèle de la V1 (craftingStatsMath.ts).
// Interpolation qualité → multiplicateur → empilement par slot → transformation absolu/percent.

export type BlueprintStatValueRange = {
  startQuality: number;
  endQuality: number;
  modifierAtStart: number;
  modifierAtEnd: number;
};

export type BlueprintStat = {
  slotName: string;
  slotDebugName: string | null;
  gpp: string;
  statNameLocKey: string;
  unitLocKey: string | null;
  mode: "absolute" | "percent";
  baseValue: number | null;
  scale: number;
  transformType: string;
  valueRanges: BlueprintStatValueRange[];
};

export type ComputedStatDisplay = {
  value: number;
  unit: string;
  deltaPct: number;
  isPercent: boolean;
};

export const DEFAULT_QUALITY = 500;

/** Interpolation linéaire par morceaux du multiplicateur pour une qualité (0-1000). */
export function interpolateMultiplier(quality: number, ranges: BlueprintStatValueRange[]): number {
  if (!ranges || ranges.length === 0) return 1;
  const sorted = [...ranges].sort((a, b) => a.startQuality - b.startQuality);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  if (quality <= first.startQuality) return first.modifierAtStart;
  if (quality >= last.endQuality) return last.modifierAtEnd;

  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i]!;
    if (quality >= r.startQuality && quality <= r.endQuality) {
      const span = r.endQuality - r.startQuality;
      if (span <= 0) return r.modifierAtStart;
      const t = (quality - r.startQuality) / span;
      return r.modifierAtStart + t * (r.modifierAtEnd - r.modifierAtStart);
    }
    // Trou entre deux segments (gap CIG) → on prend le bord le plus proche.
    if (i + 1 < sorted.length) {
      const next = sorted[i + 1]!;
      if (quality > r.endQuality && quality < next.startQuality) {
        const distA = quality - r.endQuality;
        const distB = next.startQuality - quality;
        return distA <= distB ? r.modifierAtEnd : next.modifierAtStart;
      }
    }
  }
  return 1;
}

/**
 * Valeur affichée + delta pour UNE stat (un gpp) à partir de TOUTES ses entrées slot
 * + la qualité par slot. Empile les multiplicateurs (produit) puis applique la transfo.
 * Baseline (pour le delta) : tous les slots à 500.
 */
export function computeStackedStatValue(
  entries: BlueprintStat[],
  qualityBySlot: Record<string, number>,
): ComputedStatDisplay {
  if (entries.length === 0) return { value: 0, unit: "", deltaPct: 0, isPercent: false };
  const ref = entries[0]!;

  let stackedMult = 1;
  let baseStackedMult = 1;
  for (const e of entries) {
    const slotKey = e.slotDebugName ?? e.slotName;
    const q = qualityBySlot[slotKey] ?? DEFAULT_QUALITY;
    stackedMult *= interpolateMultiplier(q, e.valueRanges);
    baseStackedMult *= interpolateMultiplier(DEFAULT_QUALITY, e.valueRanges);
  }

  if (ref.mode === "percent") {
    const pct = transformFactorToPercent(stackedMult, ref.transformType);
    const basePct = transformFactorToPercent(baseStackedMult, ref.transformType);
    return { value: pct, unit: "%", deltaPct: pct - basePct, isPercent: true };
  }

  const base = ref.baseValue ?? 0;
  const scale = Number.isFinite(ref.scale) && ref.scale !== 0 ? ref.scale : 1;
  const value = base * stackedMult * scale;
  const baseValue = base * baseStackedMult * scale;
  const deltaPct = baseValue !== 0 ? ((value - baseValue) / baseValue) * 100 : 0;
  return { value, unit: readableUnit(ref.unitLocKey), deltaPct, isPercent: false };
}

function transformFactorToPercent(mult: number, transformType: string): number {
  if (transformType === "ConvertFactorToNegatedPercentChange") return (1 - mult) * 100;
  // Défaut : ConvertFactorToPercentChange / Sequence_DamageEquivalentToPercentChange.
  return (mult - 1) * 100;
}

/** Nettoie l'unité : @LOC_EMPTY / clé non résolue / format printf % → "". */
function readableUnit(unitLocKey: string | null): string {
  if (!unitLocKey) return "";
  const trimmed = unitLocKey.trim();
  if (!trimmed) return "";
  if (trimmed === "@LOC_EMPTY") return "";
  if (trimmed.includes("%")) return "";
  if (trimmed.startsWith("@")) return "";
  return trimmed;
}

/** Formate valeur + unité pour la carte. Percent → "+5.0%" ; absolu → nombre localisé + unité. */
export function formatStatDisplay(d: ComputedStatDisplay): { value: string; unit: string } {
  if (d.isPercent) {
    const signed = d.value >= 0 ? `+${d.value.toFixed(1)}` : d.value.toFixed(1);
    return { value: `${signed}%`, unit: "" };
  }
  const v = d.value;
  const isInt = Math.abs(v - Math.round(v)) < 1e-6;
  return {
    value: v.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: isInt ? 0 : 2 }),
    unit: d.unit,
  };
}

/** Badge delta vs baseline (qualité 500) : "+5.2%" / "-3.4%" / "0%". */
export function formatDeltaBadge(d: ComputedStatDisplay): { text: string; sign: "pos" | "neg" | "zero" } {
  const v = d.deltaPct;
  if (Math.abs(v) < 0.05) return { text: "0%", sign: "zero" };
  const signed = v >= 0 ? `+${v.toFixed(1)}` : v.toFixed(1);
  return { text: `${signed}%`, sign: v >= 0 ? "pos" : "neg" };
}
