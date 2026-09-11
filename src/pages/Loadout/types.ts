type FleetShip = {
  id: number;
  name: string;
  manufacturer: string;
  acquisition: string | null;
  shipDataId: number | null;
  wikiId: string | null;
  imageUrl: string | null;
  imageTopDownUrl: string | null;
  emSignature: number | null;
  irSignature: number | null;
  crossSection: number | null;
};

interface SlotEdit {
  id?: number;
  portName: string;
  displayName: string;
  slotType: string;
  slotSize: number;
  componentClassName: string | null;
  componentName: string | null;
  componentGrade: string | null;
  componentMake: string | null;
  realDps?: number | null;
  realShieldHp?: number | null;
  realPowerDraw?: number | null;
  realAlphaDamage?: number | null;
  realShieldRegenRate?: number | null;
  realShieldDelayDmg?: number | null;
  realPowerOutput?: number | null;
  // Hiérarchie (Lot 1) : présents pour les slots issus du stock, absents pour les
  // slots d'un profil sauvegardé (rendus alors à plat, depth 0).
  hardpointId?: number | null;
  parentId?: number | null;
  depth?: number;
}

interface LoadoutWithSlots {
  id: number;
  shipId: number;
  profileName: string;
  createdAt: string;
  updatedAt: string;
  slots: SlotEdit[];
}

// Slot stock renvoyé par get_stock_for_ship : hardpoint + composant par défaut résolu,
// en pré-ordre avec depth pour le rendu hiérarchique.

type StockSlot = {
  hardpointId: number;
  parentId: number | null;
  depth: number;
  portName: string;
  displayName: string;
  slotType: string;
  subType: string | null;
  minSize: number;
  maxSize: number;
  componentClassName: string | null;
  componentName: string | null;
  componentMake: string | null;
  componentGrade: string | null;
  componentSize: number | null;
  realDps: number | null;
  realShieldHp: number | null;
  realPowerDraw: number | null;
  realAlphaDamage: number | null;
  realShieldRegenRate: number | null;
  realShieldDelayDmg: number | null;
  realPowerOutput: number | null;
};

type ComponentRow = {
  className: string;
  name: string;
  manufacturer: string | null;
  type: string;
  size: number;
  grade: string | null;
  class: string | null;
  dps: number | null;
  shieldHp: number | null;
  powerDraw: number | null;
  alphaDamage: number | null;
  shieldRegenRate: number | null;
  shieldDelayDmg: number | null;
  powerOutput: number | null;
  qtDriveSpeed: number | null;
  // Affichage picker (Lot 4) — stats clés par type.
  weaponFireRate: number | null;
  range: number | null;
  emMax: number | null;
  heatGen: number | null;
  qtSpoolTime: number | null;
  qtFuelRate: number | null;
  missileDamage: number | null;
  missileLockTime: number | null;
  missileSpeed: number | null;
  missileLockRangeMax: number | null;
  scWikiType: string | null;
  // Acquisition (Lot 5) — 1/0 + détails pour les tooltips.
  buyable: number | null;
  buyPrice: number | null;
  buyTerminal: string | null;
  craftable: number | null;
  craftTime: number | null;
  craftIngredients: number | null;
  stockShips: string | null;
};

// Vaisseau du catalogue (get_all_ship_data) pour le sélecteur + preview mode.

type CatalogShip = {
  id: number;
  name: string;
  manufacturer: string;
  imageUrl: string | null;
  imageTopDownUrl: string | null;
  emSignature: number | null;
  irSignature: number | null;
  crossSection: number | null;
};

// Sous-ensemble commun (flotte ou catalogue) pour la bannière et le panneau Performance.

type ShipMeta = {
  name: string;
  imageUrl: string | null;
  imageTopDownUrl: string | null;
  emSignature: number | null;
  irSignature: number | null;
  crossSection: number | null;
};

type Variant = "primary" | "secondary" | "tertiary";

// Découpage V1 : Armes + Missiles pleine largeur (primary), Systèmes (secondary) et
// Propulsion (tertiary) côte à côte. Armes : pas de regroupement (comme V1).

type StatSpec = { key: keyof ComponentRow; labelKey: string; unit?: string; precision?: number };
const SLOT_TYPE_SPECS: Record<string, StatSpec[]> = {
  WEAPON: [
    { key: "dps", labelKey: "loadout.spec.dps", precision: 1 },
    { key: "alphaDamage", labelKey: "loadout.spec.alpha", precision: 0 },
    { key: "weaponFireRate", labelKey: "loadout.spec.rpm", precision: 0 },
    { key: "range", labelKey: "loadout.spec.range", unit: "m", precision: 0 },
  ],
  MISSILE: [
    { key: "missileDamage", labelKey: "loadout.spec.dmg", precision: 0 },
    { key: "missileLockTime", labelKey: "loadout.spec.lock", unit: "s", precision: 1 },
    { key: "missileSpeed", labelKey: "loadout.spec.speed", unit: "m/s", precision: 0 },
    { key: "missileLockRangeMax", labelKey: "loadout.spec.range", unit: "m", precision: 0 },
  ],
  SHIELD: [
    { key: "shieldHp", labelKey: "loadout.spec.pool", unit: "hp", precision: 0 },
    { key: "shieldRegenRate", labelKey: "loadout.spec.regen", unit: "/s", precision: 1 },
    { key: "shieldDelayDmg", labelKey: "loadout.spec.delay", unit: "s", precision: 1 },
    { key: "powerDraw", labelKey: "loadout.spec.draw", unit: "kW", precision: 0 },
  ],
  POWER_PLANT: [
    { key: "powerOutput", labelKey: "loadout.spec.output", unit: "kW", precision: 0 },
    { key: "powerDraw", labelKey: "loadout.spec.draw", unit: "kW", precision: 0 },
    { key: "emMax", labelKey: "loadout.spec.em", precision: 0 },
    { key: "heatGen", labelKey: "loadout.spec.heat", precision: 0 },
  ],
  COOLER: [
    { key: "heatGen", labelKey: "loadout.spec.cooling", precision: 0 },
    { key: "powerDraw", labelKey: "loadout.spec.draw", unit: "kW", precision: 0 },
    { key: "emMax", labelKey: "loadout.spec.em", precision: 0 },
  ],
  QUANTUM_DRIVE: [
    { key: "qtDriveSpeed", labelKey: "loadout.spec.qtSpeed", unit: "Mm/s", precision: 0 },
    { key: "qtSpoolTime", labelKey: "loadout.spec.spool", unit: "s", precision: 1 },
    { key: "qtFuelRate", labelKey: "loadout.spec.fuel", precision: 2 },
    { key: "powerDraw", labelKey: "loadout.spec.draw", unit: "kW", precision: 0 },
  ],
};

// Rang numérique de grade pour le tri (A meilleur). null si absent → relégué en fin.

type AcqDetailData = {
  buy: Array<{ terminal: string | null; price: number | null }>;
  craft: { blueprintId: string; timeSeconds: number | null; ingredients: Array<{ name: string | null; qty: number | null }> } | null;
  ships: Array<string | null>;
};

export { SLOT_TYPE_SPECS };
export type { FleetShip, SlotEdit, LoadoutWithSlots, StockSlot, ComponentRow, CatalogShip, ShipMeta, Variant, StatSpec, AcqDetailData };
