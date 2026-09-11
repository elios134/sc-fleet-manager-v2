import { Crosshair, Gauge, Rocket, Shield, type LucideIcon } from "lucide-react";
import { type TFunction } from "i18next";
import { mapHardpointType, humanizePortName } from "../../lib/loadoutSlots";
import { type SlotEdit, type StockSlot, type ComponentRow, type Variant, type StatSpec } from "./types";

const SECTIONS: Array<{
  titleKey: string;
  types: string[];
  icon: LucideIcon;
  variant: Variant;
  collapsible: boolean;
  disableGrouping: boolean;
  fullWidth: boolean;
}> = [
  { titleKey: "loadout.section.weapons", types: ["WEAPON"], icon: Crosshair, variant: "primary", collapsible: true, disableGrouping: true, fullWidth: true },
  { titleKey: "loadout.section.turrets", types: ["TURRET"], icon: Crosshair, variant: "primary", collapsible: true, disableGrouping: true, fullWidth: true },
  { titleKey: "loadout.section.missiles", types: ["MISSILE"], icon: Rocket, variant: "primary", collapsible: true, disableGrouping: false, fullWidth: true },
  { titleKey: "loadout.section.systems", types: ["SHIELD", "POWER_PLANT"], icon: Shield, variant: "secondary", collapsible: false, disableGrouping: false, fullWidth: false },
  { titleKey: "loadout.section.propulsion", types: ["QUANTUM_DRIVE", "COOLER"], icon: Gauge, variant: "tertiary", collapsible: false, disableGrouping: false, fullWidth: false },
];

// Couleurs par variante (codes V1 adaptés au thème sombre V2 : bleu / or / bleu clair).
const VARIANT_COLOR: Record<Variant, string> = {
  primary: "#60a5fa",
  secondary: "#fbbf24",
  tertiary: "#93ccff",
};
const VARIANT_BORDER: Record<Variant, string> = {
  primary: "rgba(96,165,250,0.35)",
  secondary: "rgba(251,191,36,0.35)",
  tertiary: "rgba(147,204,255,0.35)",
};
const VARIANT_LINE: Record<Variant, string> = {
  primary: "rgba(96,165,250,0.25)",
  secondary: "rgba(251,191,36,0.25)",
  tertiary: "rgba(147,204,255,0.25)",
};

// Stats clés affichées dans le picker par type de slot (réplique slotTypeSpecs.ts V1,
// clés aplaties pour correspondre aux champs remontés par get_components_for_slot).

function gradeRank(grade: string | null): number | null {
  switch (grade) {
    case "A": return 4;
    case "B": return 3;
    case "C": return 2;
    case "D": return 1;
    default: return null;
  }
}

// Couleurs de grade (réplique V1 : A vert / B bleu / C gris / D orange).

function gradeColor(grade: string): string {
  switch (grade) {
    case "A": return "rgba(0,204,102,0.8)";
    case "B": return "rgba(96,165,250,0.85)";
    case "C": return "rgba(140,145,155,0.7)";
    case "D": return "rgba(255,136,0,0.75)";
    default: return "rgba(100,105,115,0.55)";
  }
}

// Sous-titre des slots : type d'arme dérivé du className (réplique deriveWeaponType V1).

function deriveWeaponType(className: string | null): string | null {
  if (!className) return null;
  const segs = className.split("_").filter(Boolean);
  if (segs.length < 2) return null;
  const candidates = segs.slice(1).filter((s) => !/^S\d+$/.test(s) && s !== s.toUpperCase());
  if (!candidates[0]) return null;
  return candidates[0].replace(/([A-Z])/g, " $1").trim().toUpperCase();
}

function getStat(c: ComponentRow, key: keyof ComponentRow): number | null {
  const v = c[key];
  return typeof v === "number" ? v : null;
}

function formatStat(val: number | null, spec: StatSpec): string {
  if (val == null) return "—";
  const str = spec.precision != null ? val.toFixed(spec.precision) : String(Math.round(val));
  return spec.unit ? `${str}${spec.unit}` : str;
}

// Convertit un slot stock en slot éditable : PRÉ-REMPLI avec le composant par défaut
// (Lot 1 #1) et porteur de la hiérarchie (hardpointId / parentId / depth, Lot 1 #2).

function stockSlotToEdit(s: StockSlot): SlotEdit | null {
  const slotType = mapHardpointType(s.slotType) ?? s.slotType;
  if (!slotType) return null;
  return {
    portName: s.portName,
    displayName: s.displayName || s.portName,
    slotType,
    slotSize: s.maxSize,
    componentClassName: s.componentClassName,
    componentName: s.componentName,
    componentGrade: s.componentGrade,
    componentMake: s.componentMake,
    realDps: s.realDps,
    realShieldHp: s.realShieldHp,
    realPowerDraw: s.realPowerDraw,
    realAlphaDamage: s.realAlphaDamage,
    realShieldRegenRate: s.realShieldRegenRate,
    realShieldDelayDmg: s.realShieldDelayDmg,
    realPowerOutput: s.realPowerOutput,
    hardpointId: s.hardpointId,
    parentId: s.parentId,
    depth: s.depth,
  };
}

function profileSlotToEdit(s: SlotEdit): SlotEdit {
  return { ...s, displayName: s.displayName || s.portName || s.slotType };
}

function groupRoots(
  entries: Array<{ idx: number }>,
  slots: SlotEdit[],
  disabled: boolean,
): Array<{ idx: number; count: number }> {
  if (disabled) return entries.map((e) => ({ idx: e.idx, count: 1 }));
  const result: Array<{ idx: number; count: number }> = [];
  let i = 0;
  while (i < entries.length) {
    const cur = slots[entries[i].idx];
    const key = cur.componentClassName;
    if (!key || !cur.componentName) {
      result.push({ idx: entries[i].idx, count: 1 });
      i++;
      continue;
    }
    let j = i + 1;
    while (j < entries.length && slots[entries[j].idx].componentClassName === key) j++;
    result.push({ idx: entries[i].idx, count: j - i });
    i = j;
  }
  return result;
}

function mountName(slot: SlotEdit): string {
  const n = slot.componentName;
  if (n && n.trim()) return n.replace(/\s+(Gimbal\s+)?Mount$/i, "").trim();
  return humanizePortName(slot.portName || slot.displayName || slot.slotType);
}

// En-tête de conteneur / mount / rack : affiche le nom du composant + taille + badge ×N.
// Cliquable (mount gimbal, tourelle distante, rack missiles) ou statique (tourelle habitée,
// sans composant échangeable). La section parente indique déjà s'il s'agit d'une tourelle.

function treeChildren(
  idx: number,
  editSlots: SlotEdit[],
  childIdxByParent: Map<number, number[]>,
  families: string[],
): number[] {
  const s = editSlots[idx];
  const arr = s.hardpointId != null ? childIdxByParent.get(s.hardpointId) ?? [] : [];
  return arr.filter((ci) => families.includes(editSlots[ci].slotType));
}

// Signature récursive d'un sous-arbre (type|composant|taille|enfants triés). Sert à
// regrouper les frères STRICTEMENT identiques (ex. 2 gimbals identiques → ×2).

function nodeSig(
  idx: number,
  editSlots: SlotEdit[],
  childIdxByParent: Map<number, number[]>,
  families: string[],
): string {
  const s = editSlots[idx];
  const kids = treeChildren(idx, editSlots, childIdxByParent, families);
  const childSig = kids
    .map((k) => nodeSig(k, editSlots, childIdxByParent, families))
    .sort()
    .join(",");
  return `${s.slotType}|${s.componentClassName ?? "∅"}|${s.slotSize}|[${childSig}]`;
}

// Regroupe une liste de frères par signature identique (ordre de 1ʳᵉ apparition préservé).

function groupSiblings(
  indices: number[],
  editSlots: SlotEdit[],
  childIdxByParent: Map<number, number[]>,
  families: string[],
): Array<{ rep: number; members: number[] }> {
  const map = new Map<string, number[]>();
  for (const i of indices) {
    const sig = nodeSig(i, editSlots, childIdxByParent, families);
    const arr = map.get(sig) ?? [];
    arr.push(i);
    map.set(sig, arr);
  }
  return Array.from(map.values()).map((members) => ({ rep: members[0], members }));
}

// Rendu façon erkul (récursif). `mult` = multiplicité héritée d'un ancêtre groupé ; `count`
// = nb réel d'exemplaires que cette ligne représente (members.length × mult). Les frères
// identiques sont regroupés (×N) ; les racines de section ne le sont jamais (rendues 1 à 1).
// Édition : missiles → tous les membres (changement groupé) ; armes → le représentant seul
// (la ligne se dégroupe alors). Conteneurs TURRET habités : non cliquables (pas de composant).

function aggregateLoadoutStats(slots: SlotEdit[]) {
  let totalDps = 0;
  let totalAlphaDamage = 0;
  let totalShieldHp = 0;
  let shieldRegenRate = 0; // SOMME (les boucliers s'additionnent)
  let shieldDelayDmg: number | null = null; // MAX (pire cas)
  let totalPowerDraw = 0; // tous les slots
  let totalPowerOutput = 0; // POWER_PLANT

  for (const s of slots) {
    totalPowerDraw += s.realPowerDraw ?? 0;
    switch (s.slotType) {
      case "WEAPON":
        totalDps += s.realDps ?? 0;
        if (s.realAlphaDamage != null) totalAlphaDamage += s.realAlphaDamage;
        break;
      case "SHIELD":
        totalShieldHp += s.realShieldHp ?? 0;
        if (s.realShieldRegenRate != null) shieldRegenRate += s.realShieldRegenRate;
        if (s.realShieldDelayDmg != null) {
          shieldDelayDmg =
            shieldDelayDmg == null
              ? s.realShieldDelayDmg
              : Math.max(shieldDelayDmg, s.realShieldDelayDmg);
        }
        break;
      case "POWER_PLANT":
        if (s.realPowerOutput != null) totalPowerOutput += s.realPowerOutput;
        break;
    }
  }

  const powerMargin =
    totalPowerOutput > 0
      ? ((totalPowerOutput - totalPowerDraw) / totalPowerOutput) * 100
      : null;

  return {
    totalDps,
    totalAlphaDamage,
    totalShieldHp,
    shieldRegenRate,
    shieldDelayDmg,
    totalPowerDraw,
    totalPowerOutput,
    powerMargin,
  };
}

// Seuils de signature V1 (PerformanceSummary.tsx getSignatureLevel).

function getSignatureLevel(crossSection: number | null, t: TFunction): string {
  if (crossSection == null) return "—";
  if (crossSection < 20000) return t("loadout.sigMinimal");
  if (crossSection < 80000) return t("loadout.sigLow");
  if (crossSection < 300000) return t("loadout.sigMedium");
  return t("loadout.sigHigh");
}

const fmtStat = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 0 });

export { SECTIONS, gradeRank, gradeColor, deriveWeaponType, getStat, formatStat, stockSlotToEdit, profileSlotToEdit, groupRoots, mountName, treeChildren, nodeSig, groupSiblings, aggregateLoadoutStats, getSignatureLevel, VARIANT_COLOR, VARIANT_BORDER, VARIANT_LINE, fmtStat };
