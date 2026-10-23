// Comparateur de loadouts (logique pure, testée) : stats d'un loadout, écart en % avec la
// référence selon le sens de la stat, différences d'équipement par famille.
import { aggregateLoadoutStats, type StatSlot } from "../../../lib/loadoutStats";

/** Emplacement d'un loadout (stock ou profil sauvegardé). */
export type EquipSlot = StatSlot & { componentName: string | null; componentClassName: string | null };
export type LoadoutStats = {
  dps: number;
  alpha: number;
  shieldHp: number;
  regen: number;
  delay: number | null;
  margin: number | null;
  signature: number | null;
};
export type Metric = { key: keyof LoadoutStats; labelKey: string; higherIsBetter: boolean; unit: string; digits: number };

export const METRICS: Metric[] = [
  { key: "dps", labelKey: "comparator.lo.dps", higherIsBetter: true, unit: "", digits: 0 },
  { key: "alpha", labelKey: "comparator.lo.alpha", higherIsBetter: true, unit: "", digits: 0 },
  { key: "shieldHp", labelKey: "comparator.lo.shieldHp", higherIsBetter: true, unit: "", digits: 0 },
  { key: "regen", labelKey: "comparator.lo.regen", higherIsBetter: true, unit: "/s", digits: 0 },
  { key: "delay", labelKey: "comparator.lo.delay", higherIsBetter: false, unit: " s", digits: 1 },
  { key: "margin", labelKey: "comparator.lo.margin", higherIsBetter: true, unit: " %", digits: 0 },
  { key: "signature", labelKey: "comparator.lo.signature", higherIsBetter: false, unit: "", digits: 0 },
];

export function loadoutStats(slots: EquipSlot[], crossSection: number | null): LoadoutStats {
  const s = aggregateLoadoutStats(slots);
  return {
    dps: s.totalDps,
    alpha: s.totalAlphaDamage,
    shieldHp: s.totalShieldHp,
    regen: s.shieldRegenRate,
    delay: s.shieldDelayDmg,
    margin: s.powerMargin,
    signature: crossSection,
  };
}

/** Écart (%) de `value` avec la référence ; `good` selon le sens de la stat, null si l'écart
 *  est négligeable (< 0,5 %) ou incalculable. */
export function delta(ref: number | null, value: number | null, higherIsBetter: boolean): { pct: number | null; good: boolean | null } {
  if (ref == null || value == null || ref === 0) return { pct: null, good: null };
  const pct = Math.round(((value - ref) / Math.abs(ref)) * 1000) / 10;
  return { pct, good: Math.abs(pct) < 0.5 ? null : higherIsBetter ? pct > 0 : pct < 0 };
}

const GROUPS = ["WEAPON", "MISSILE", "SHIELD", "POWER_PLANT", "COOLER", "QUANTUM_DRIVE"];

/** Résumé « Nom ×N, Autre » des composants d'une famille (montures ignorées), « — » si vide. */
function summary(slots: EquipSlot[], group: string): string {
  const counts = new Map<string, number>();
  for (const s of slots) {
    if (s.slotType !== group || !s.componentName || /^mount_/i.test(s.componentClassName ?? "")) continue;
    counts.set(s.componentName, (counts.get(s.componentName) ?? 0) + 1);
  }
  if (!counts.size) return "—";
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([n, c]) => (c > 1 ? `${n} ×${c}` : n))
    .join(", ");
}

/** Équipement de chaque colonne par famille ; `differs` si une colonne diffère de la référence. */
export function equipmentDiff(cols: EquipSlot[][]): { group: string; values: string[]; differs: boolean }[] {
  return GROUPS.map((group) => {
    const values = cols.map((c) => summary(c, group));
    return { group, values, differs: values.some((v) => v !== values[0]) };
  }).filter((r) => r.values.some((v) => v !== "—"));
}
