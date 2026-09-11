import { type TFunction } from "i18next";
import { Atom, Backpack, Crosshair, Fan, HardHat, Magnet, Package, Pickaxe, Plug, Radar, Recycle, Shield, Shirt, Target, Zap, type LucideIcon } from "lucide-react";
import { type CraftingHubBlueprintItem, type CraftModifier, type CraftIngredient, type SlotGroup, type Family } from "./types";

// Regroupe les ingrédients par EMPLACEMENT (slot). Les ingrédients partageant un même
// selectionGroup (≠ null) sont des ALTERNATIVES d'un seul slot ; sinon, un slot par
// ingrédient. Ordre conservé (champ order). Repli : si aucun slot réel (tout « Recette »
// ou null), renvoie null → le front affiche la liste à plat comme avant.
function groupIngredientsBySlot(ings: CraftIngredient[]): SlotGroup[] | null {
  const hasSlots = ings.some((i) => i.slotName && i.slotName !== "Recette");
  if (!hasSlots) return null;
  const sorted = [...ings].sort((a, b) => a.order - b.order);
  const groups: SlotGroup[] = [];
  const byGroup = new Map<string, SlotGroup>();
  for (const ing of sorted) {
    const slotName = ing.slotName || "Recette";
    const title = ing.slotLabel || ing.slotName || "Recette";
    if (ing.selectionGroup) {
      let g = byGroup.get(ing.selectionGroup);
      if (!g) {
        g = { slotName, title, requiredCount: ing.requiredCount, items: [] };
        byGroup.set(ing.selectionGroup, g);
        groups.push(g);
      }
      g.items.push(ing);
    } else {
      groups.push({ slotName, title, requiredCount: ing.requiredCount, items: [ing] });
    }
  }
  return groups;
}

// Multiplicateur d'un modifier à une qualité donnée (interpolation linéaire entre
// at_min_quality @ quality_range.min et at_max_quality @ quality_range.max).
function modifierMultiplier(mod: CraftModifier, quality: number): number {
  const qMin = mod.quality_range?.min ?? 0;
  const qMax = mod.quality_range?.max ?? 1000;
  const aMin = mod.modifier_range?.at_min_quality ?? 1;
  const aMax = mod.modifier_range?.at_max_quality ?? 1;
  if (qMax <= qMin) return aMin;
  const t = Math.min(1, Math.max(0, (quality - qMin) / (qMax - qMin)));
  return aMin + t * (aMax - aMin);
}

function fmtSignedPercent(mult: number): string {
  const pct = Math.round((mult - 1) * 100 * 10) / 10;
  if (pct === 0) return "0 %";
  const sign = pct > 0 ? "+" : "−";
  return `${sign}${Math.abs(pct).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
}

function formatCraftTime(seconds: number | null): string {
  if (seconds == null) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (s > 0 || parts.length === 0) parts.push(`${s}s`);
  return parts.join(" ");
}

const FAMILY_ORDER: Family[] = [
  "Armures FPS",
  "Armes FPS",
  "Composants vaisseau",
  "Armes vaisseau",
  "Objets mission",
  "Autres",
];

// Libellé traduit d'une famille (la valeur FR interne sert de clé d'état/filtre).
const FAMILY_KEY: Record<Family, string> = {
  "Armures FPS": "crafting.family.fpsArmours",
  "Armes FPS": "crafting.family.fpsWeapons",
  "Composants vaisseau": "crafting.family.shipComponents",
  "Armes vaisseau": "crafting.family.shipWeapons",
  "Objets mission": "crafting.family.missionItems",
  Autres: "crafting.family.other",
};

function familyLabel(fam: Family, t: TFunction): string {
  return t(FAMILY_KEY[fam]);
}

const SHIP_WEAPON_TYPES = new Set([
  "WeaponGun",
  "Turret",
  "WeaponDefensive",
  "Missile",
  "MissileLauncher",
  "Ordnance",
  "Bomb",
]);

// Types vaisseau connus (pour signaler ceux qui tombent par défaut sans être listés).
const KNOWN_SHIP_COMPONENT_TYPES = new Set([
  "Cooler",
  "Shield",
  "PowerPlant",
  "QuantumDrive",
  "Radar",
  "Scanner",
  "DockingCollar",
  "TractorBeam",
  "FuelIntake",
  "FuelTank",
  "MiningModifier",
  "SalvageModifier",
  "QuantumInterdictionGenerator",
  "EMP",
  "SelfDestruct",
]);

function familyOf(type: string): Family {
  if (!type) return "Autres";
  if (type.startsWith("Char_Armor")) return "Armures FPS";
  if (type.startsWith("WeaponPersonal") || type === "Gadget") return "Armes FPS";
  if (SHIP_WEAPON_TYPES.has(type)) return "Armes vaisseau";
  if (type === "MissionItem" || type.startsWith("Mission")) return "Objets mission";
  // Reste = matériel vaisseau (famille la plus proche). Les types inconnus sont signalés.
  return "Composants vaisseau";
}

/* ── Suggestion de blueprint pour un nom de log non apparié (similarité) ── */
// Synonymes FR↔EN (le log FR peut différer du nom EN/FR en base : pièce d'armure,
// type d'arme…). Permet ex. « Torse Aril » → « Aril Core », « Bras » → « arms ».
const MATCH_SYNONYMS: Record<string, string> = {
  bras: "arms",
  brassards: "arms",
  jambes: "legs",
  jambieres: "legs",
  torse: "core",
  plastron: "core",
  casque: "helmet",
  dos: "backpack",
  fusil: "rifle",
  pistolet: "pistol",
  canon: "cannon",
  chargeur: "magazine",
  arbalete: "crossbow",
};

const MATCH_STOPWORDS = new Set(["de", "la", "le", "du", "des", "a", "the", "of"]);

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function matchTokens(s: string): string[] {
  return stripAccents(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((tok) => tok.length > 1 && !MATCH_STOPWORDS.has(tok))
    .map((tok) => MATCH_SYNONYMS[tok] ?? tok);
}

function tokenHit(a: string, b: string): boolean {
  if (a === b) return true;
  // Préfixe commun ≥ 4 (Bras⊂Brassards, Jamb…) pour tolérer les variantes.
  return Math.min(a.length, b.length) >= 4 && a.slice(0, 4) === b.slice(0, 4);
}

// Meilleur blueprint pour un nom de log : score = part des tokens du log retrouvés
// dans (displayName + producedItemName) du candidat. null sous le seuil de confiance.
function suggestBlueprint(
  logName: string,
  items: CraftingHubBlueprintItem[],
): CraftingHubBlueprintItem | null {
  const lt = matchTokens(logName);
  if (lt.length === 0) return null;
  let best: CraftingHubBlueprintItem | null = null;
  let bestScore = 0;
  let bestGap = Infinity;
  for (const it of items) {
    const ct = [
      ...new Set([...matchTokens(it.displayName), ...matchTokens(it.producedItemName ?? "")]),
    ];
    let matched = 0;
    for (const tok of lt) if (ct.some((c) => tokenHit(c, tok))) matched++;
    const score = matched / lt.length;
    const gap = Math.abs(ct.length - lt.length);
    if (score > bestScore || (score === bestScore && gap < bestGap)) {
      best = it;
      bestScore = score;
      bestGap = gap;
    }
  }
  return bestScore >= 0.5 ? best : null;
}

// Icône par type (calque l'esprit de getBlueprintIconKey V1, mappé sur output.type V2).
function getBlueprintIcon(type: string): LucideIcon {
  if (type.startsWith("Char_Armor_Helmet")) return HardHat;
  if (type.startsWith("Char_Armor_Backpack")) return Backpack;
  if (type.startsWith("Char_Armor")) return Shirt;
  switch (type) {
    case "Shield":
      return Shield;
    case "Cooler":
      return Fan;
    case "PowerPlant":
      return Zap;
    case "QuantumDrive":
      return Atom;
    case "Radar":
    case "Scanner":
      return Radar;
    case "DockingCollar":
      return Plug;
    case "WeaponGun":
    case "Turret":
    case "WeaponDefensive":
      return Target;
    case "WeaponPersonal":
      return Crosshair;
    case "TractorBeam":
      return Magnet;
    case "MiningModifier":
      return Pickaxe;
    case "SalvageModifier":
      return Recycle;
    default:
      return Package;
  }
}

// Taille S1–S6 : dérivée du suffixe _sN de output_class (producedItemEntityClass).
// Null pour les objets sans taille (armures FPS).
function extractSizeTag(className: string | null): string | null {
  if (!className) return null;
  const m = /_s(\d)(?:_|$)/i.exec(className) ?? /s(\d)$/i.exec(className);
  return m ? `S${m[1]}` : null;
}

const SYSTEM_LABEL: Record<string, string> = { stanton: "Stanton", pyro: "Pyro", nyx: "Nyx" };

const SYSTEM_ORDER = ["stanton", "pyro", "nyx"];

// Clés i18n des méthodes/raretés (valeurs d'enum issues des données → libellés UI traduits).
const METHOD_KEY: Record<string, string> = {
  fps: "crafting.method.fps",
  ground_vehicle: "crafting.method.vehicle",
  ship: "crafting.method.ship",
};

const RARITY_KEY: Record<string, string> = {
  common: "crafting.rarity.common",
  uncommon: "crafting.rarity.uncommon",
  rare: "crafting.rarity.rare",
  epic: "crafting.rarity.epic",
  legendary: "crafting.rarity.legendary",
};

export { groupIngredientsBySlot, modifierMultiplier, fmtSignedPercent, formatCraftTime, FAMILY_ORDER, FAMILY_KEY, familyLabel, SHIP_WEAPON_TYPES, KNOWN_SHIP_COMPONENT_TYPES, familyOf, MATCH_SYNONYMS, MATCH_STOPWORDS, stripAccents, matchTokens, tokenHit, suggestBlueprint, getBlueprintIcon, extractSizeTag, SYSTEM_LABEL, SYSTEM_ORDER, METHOD_KEY, RARITY_KEY };
