import { useEffect, useMemo, useState } from "react";
import { useBlocker, useLocation, useNavigate } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import Dropdown from "../components/ui/Dropdown";
import {
  ChevronDown,
  ChevronUp,
  Crosshair,
  Gauge,
  Hammer,
  Loader2,
  Package,
  PackageOpen,
  Plus,
  Rocket,
  Search,
  Settings,
  Shield,
  ShoppingCart,
  X,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { refreshStarjumpManifest, resolveShipTopDownUrl } from "../lib/starjump";

/* ── Types ── */

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

function humanizePortName(portName: string): string {
  return portName.replace(/^hardpoint_/i, "").replace(/_/g, " ").toUpperCase();
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

// Mappe un type de hardpoint brut vers un slotType canonique (CHECK LoadoutSlot).
function mapHardpointType(raw: string): string | null {
  const t = raw.toUpperCase();
  // Conteneur de tourelle : à préserver AVANT la règle WEAPON (qui capte "TURRET").
  if (t === "TURRET") return "TURRET";
  if (t.includes("MISSILE") || t.includes("ROCKET")) return "MISSILE";
  if (t.includes("WEAPON") || t.includes("GUN") || t.includes("TURRET") || t.includes("CANNON"))
    return "WEAPON";
  if (t.includes("SHIELD")) return "SHIELD";
  if (t.includes("POWER")) return "POWER_PLANT";
  if (t.includes("QUANTUM") || t.includes("QDRIVE")) return "QUANTUM_DRIVE";
  if (t.includes("COOL")) return "COOLER";
  return null;
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

export default function LoadoutPage() {
  const { t } = useTranslation();
  const location = useLocation();
  // Modifs non sauvegardées (pour confirmer avant de quitter la page).
  const [dirty, setDirty] = useState(false);
  const [accountId, setAccountId] = useState<string>("");
  const [fleetShips, setFleetShips] = useState<FleetShip[]>([]);
  const [catalogShips, setCatalogShips] = useState<CatalogShip[]>([]);
  const [activeShipId, setActiveShipId] = useState<number | null>(null);
  // Preview mode : vaisseau du catalogue (non possédé) sélectionné → ShipData.id.
  const [previewShipDataId, setPreviewShipDataId] = useState<number | null>(null);
  const [loadouts, setLoadouts] = useState<LoadoutWithSlots[]>([]);
  const [activeLoadoutId, setActiveLoadoutId] = useState<number | null>(null);
  const [editSlots, setEditSlots] = useState<SlotEdit[]>([]);
  const [stock, setStock] = useState<StockSlot[]>([]);
  // Slots ciblés par la modal. 1 élément (cas normal) ou N (groupe missiles édité ensemble).
  const [modalMembers, setModalMembers] = useState<number[]>([]);
  const [profileNameDraft, setProfileNameDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Mount : compte + flotte ──
  useEffect(() => {
    let cancelled = false;
    // Rafraîchit le manifeste Starjump en arrière-plan (best-effort, bundle sinon).
    void refreshStarjumpManifest();
    void (async () => {
      setLoading(true);
      try {
        const active = await invoke<string | null>("get_active_account_id");
        const acc = active ?? "";
        const [ships, allShipData] = await Promise.all([
          invoke<FleetShip[]>("get_fleet_ships_for_loadout", { accountId: acc }),
          invoke<CatalogShip[]>("get_all_ship_data"),
        ]);
        if (cancelled) return;
        setAccountId(acc);
        setFleetShips(ships);
        // Catalogue = tout le catalogue moins les vaisseaux déjà en flotte (par nom).
        const fleetNames = new Set(ships.map((s) => s.name.toLowerCase()));
        setCatalogShips(allShipData.filter((s) => !fleetNames.has(s.name.toLowerCase())));
        if (ships.length > 0) {
          // Vaisseau pré-sélectionné depuis la fiche (« Ouvrir le configurateur »), sinon 1er.
          const preselectId = (location.state as { preselectShipId?: number } | null)
            ?.preselectShipId;
          const target =
            preselectId != null && ships.some((s) => s.id === preselectId)
              ? preselectId
              : ships[0].id;
          await loadShip(target, ships, acc);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadShip(shipId: number, ships = fleetShips, acc = accountId) {
    setActiveShipId(shipId);
    setPreviewShipDataId(null);
    setError(null);
    const ship = ships.find((s) => s.id === shipId);
    try {
      const [lo, st] = await Promise.all([
        invoke<LoadoutWithSlots[]>("get_loadouts_by_ship", { shipId, accountId: acc }),
        ship?.shipDataId != null
          ? invoke<StockSlot[]>("get_stock_for_ship", { shipDataId: ship.shipDataId })
          : Promise.resolve([] as StockSlot[]),
      ]);
      setStock(st);
      setLoadouts(lo);
      if (lo.length > 0) {
        applyProfile(lo[0]);
      } else {
        applyStock(st);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  // PREVIEW MODE : vaisseau du catalogue (non possédé) → stock seul, pas de profils,
  // sauvegarde interdite (réplique V1 selectCatalogShip + saveProfile).
  async function loadCatalogShip(shipDataId: number) {
    setActiveShipId(null);
    setPreviewShipDataId(shipDataId);
    setError(null);
    setLoadouts([]);
    setActiveLoadoutId(null);
    try {
      const st = await invoke<StockSlot[]>("get_stock_for_ship", { shipDataId });
      setStock(st);
      applyStock(st);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function applyProfile(loadout: LoadoutWithSlots) {
    setActiveLoadoutId(loadout.id);
    setProfileNameDraft(loadout.profileName);
    setEditSlots(loadout.slots.map(profileSlotToEdit));
    setDirty(false);
  }

  // Nouveau profil = repart de la config STOCK (pré-remplie + hiérarchique), comme V1.
  function applyStock(st: StockSlot[]) {
    setActiveLoadoutId(null);
    setProfileNameDraft("");
    setEditSlots(st.map(stockSlotToEdit).filter((s): s is SlotEdit => s !== null));
    setDirty(false);
  }

  function newProfile() {
    applyStock(stock);
  }

  async function deleteProfile(id: number) {
    try {
      await invoke("delete_loadout", { loadoutId: id });
      if (activeShipId != null) await loadShip(activeShipId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function save() {
    if (activeShipId == null) return;
    setSaving(true);
    try {
      const newId = await invoke<number>("save_loadout", {
        shipId: activeShipId,
        profileName: profileNameDraft.trim() || t("loadout.defaultProfileName"),
        accountId,
        slots: editSlots,
      });
      const lo = await invoke<LoadoutWithSlots[]>("get_loadouts_by_ship", {
        shipId: activeShipId,
        accountId,
      });
      setLoadouts(lo);
      const created = lo.find((l) => l.id === newId);
      if (created) applyProfile(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  // Ouvre la modal sur un ou plusieurs slots (groupe missiles → tous édités ensemble).
  function openPicker(idxs: number[]) {
    if (isRented || idxs.length === 0) return;
    setModalMembers(idxs);
  }

  function pickComponent(comp: ComponentRow) {
    if (modalMembers.length === 0) return;
    const set = new Set(modalMembers);
    setEditSlots((prev) =>
      prev.map((s, i) =>
        set.has(i)
          ? {
              ...s,
              componentClassName: comp.className,
              componentName: comp.name,
              componentGrade: comp.grade,
              componentMake: comp.manufacturer,
              realDps: comp.dps,
              realShieldHp: comp.shieldHp,
              realPowerDraw: comp.powerDraw,
              realAlphaDamage: comp.alphaDamage,
              realShieldRegenRate: comp.shieldRegenRate,
              realShieldDelayDmg: comp.shieldDelayDmg,
              realPowerOutput: comp.powerOutput,
            }
          : s,
      ),
    );
    setDirty(true);
    setModalMembers([]);
  }

  function clearSlot() {
    if (modalMembers.length === 0) return;
    const set = new Set(modalMembers);
    setEditSlots((prev) =>
      prev.map((s, i) =>
        set.has(i)
          ? {
              ...s,
              componentClassName: null,
              componentName: null,
              componentGrade: null,
              componentMake: null,
              realDps: null,
              realShieldHp: null,
              realPowerDraw: null,
              realAlphaDamage: null,
              realShieldRegenRate: null,
              realShieldDelayDmg: null,
              realPowerOutput: null,
            }
          : s,
      ),
    );
    setDirty(true);
    setModalMembers([]);
  }

  const modalIndex = modalMembers.length > 0 ? modalMembers[0] : null;
  const modalSlot = modalIndex != null ? editSlots[modalIndex] : null;
  const isPreview = previewShipDataId != null;
  const hasSelection = activeShipId != null || isPreview;
  const activeFleetShip = fleetShips.find((s) => s.id === activeShipId) ?? null;
  // Vaisseau loué : loadout de base figé (lecture seule) — pas d'édition ni de sauvegarde.
  const isRented = activeFleetShip?.acquisition === "rented";
  const activeCatalogShip = catalogShips.find((s) => s.id === previewShipDataId) ?? null;
  const activeShipDataId = isPreview ? previewShipDataId : activeFleetShip?.shipDataId ?? null;
  const activeShipMeta: ShipMeta | null = isPreview ? activeCatalogShip : activeFleetShip;

  // Confirmation avant de quitter la page si des modifs ne sont pas sauvegardées
  // (ex. clic « Afficher en détails » qui navigue vers /crafting ou /catalogue).
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && currentLocation.pathname !== nextLocation.pathname,
  );

  // Index des enfants par hardpoint parent → rendu hiérarchique (trait de liaison).
  const childIdxByParent = new Map<number, number[]>();
  const presentHpIds = new Set<number>();
  editSlots.forEach((s) => {
    if (s.hardpointId != null) presentHpIds.add(s.hardpointId);
  });
  editSlots.forEach((s, idx) => {
    if (s.parentId != null) {
      const arr = childIdxByParent.get(s.parentId) ?? [];
      arr.push(idx);
      childIdxByParent.set(s.parentId, arr);
    }
  });
  // Tri par taille décroissante (convention erkul : plus grosses armes en premier).
  childIdxByParent.forEach((arr) =>
    arr.sort((a, b) => editSlots[b].slotSize - editSlots[a].slotSize),
  );
  // Un slot est une racine s'il n'a pas de parent, ou si son parent n'est pas dans le jeu
  // courant (orphelin → remonté en racine). Remplace le filtre par depth, qui n'était pas
  // persisté dans les profils sauvegardés (la hiérarchie s'effondrait après sauvegarde).
  const isRootSlot = (s: SlotEdit) => s.parentId == null || !presentHpIds.has(s.parentId);

  return (
    <div className="p-8">
      <header className="mb-6">
        <p className="text-xs uppercase tracking-[0.18em] text-white/40">{t("loadout.subtitlePrefix")}</p>
        <h1 className="text-2xl font-bold text-white">{t("loadout.title")}</h1>
      </header>

      {loading ? (
        <div className="flex items-center gap-2 text-white/50">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("loadout.loadingShort")}
        </div>
      ) : (
        <>
          {error && (
            <p className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
              {error}
            </p>
          )}

          <div className="flex flex-col gap-6 lg:flex-row">
            {/* Colonne gauche ~65% */}
            <div className="lg:w-[65%]">
              {/* Sélecteur ship : deux groupes — Ma flotte / Catalogue (réplique V1) */}
              <Dropdown
                value={
                  activeShipId != null
                    ? `fleet:${activeShipId}`
                    : isPreview
                      ? `catalog:${previewShipDataId}`
                      : ""
                }
                onChange={(val) => {
                  if (val.startsWith("fleet:")) void loadShip(Number(val.slice(6)));
                  else if (val.startsWith("catalog:")) void loadCatalogShip(Number(val.slice(8)));
                }}
                placeholder={t("loadout.noShipOption")}
                searchable
                searchPlaceholder={t("common.searchPlaceholder")}
                className="mb-4 w-full max-w-md"
                buttonClassName="rounded-xl px-3 py-2.5"
                ariaLabel={t("loadout.noShipOption")}
                groups={[
                  ...(fleetShips.length > 0
                    ? [
                        {
                          label: t("loadout.groupMyFleet"),
                          options: fleetShips.map((s) => ({
                            value: `fleet:${s.id}`,
                            label: `${s.name} — ${s.manufacturer}`,
                          })),
                        },
                      ]
                    : []),
                  ...(catalogShips.length > 0
                    ? [
                        {
                          label: t("loadout.groupCatalog2"),
                          options: catalogShips.map((s) => ({
                            value: `catalog:${s.id}`,
                            label: `${s.name} — ${s.manufacturer}`,
                          })),
                        },
                      ]
                    : []),
                ]}
              />

              {hasSelection && (
                <>
                  {/* Bandeau mode aperçu (vaisseau du catalogue, non possédé) */}
                  {isPreview && (
                    <div
                      className="mb-4 rounded-xl border px-4 py-2.5 text-sm"
                      style={{
                        background: "rgba(255,136,0,0.08)",
                        borderColor: "rgba(255,136,0,0.3)",
                        color: "rgba(255,170,80,0.95)",
                      }}
                    >
                      <strong>{t("loadout.previewModeTitle")}</strong> — {t("loadout.previewModeDesc")}
                    </div>
                  )}
                  {/* Vaisseau loué : loadout de base non modifiable */}
                  {isRented && !isPreview && (
                    <div
                      className="mb-4 rounded-xl border px-4 py-2.5 text-sm"
                      style={{
                        background: "rgba(96,165,250,0.08)",
                        borderColor: "rgba(96,165,250,0.3)",
                        color: "rgba(147,197,253,0.95)",
                      }}
                    >
                      <strong>{t("loadout.rentedReadonlyTitle")}</strong> — {t("loadout.rentedReadonlyDesc")}
                    </div>
                  )}
                  {/* Profils (masqués en aperçu ET pour un vaisseau loué : pas de sauvegarde) */}
                  {!isPreview && !isRented && (
                  <div className="mb-5 rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      {loadouts.map((l) => (
                        <div
                          key={l.id}
                          className={[
                            "flex items-center gap-1 rounded-full border px-3 py-1 text-sm",
                            activeLoadoutId === l.id
                              ? "border-indigo-500/30 bg-indigo-500/20 text-white"
                              : "border-white/10 bg-white/5 text-white/60",
                          ].join(" ")}
                        >
                          <button onClick={() => applyProfile(l)}>{l.profileName}</button>
                          <button
                            onClick={() => void deleteProfile(l.id)}
                            className="text-white/40 hover:text-red-300"
                            title={t("loadout.deleteProfileTitle")}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={newProfile}
                        className="flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-white/70 hover:bg-white/10"
                      >
                        <Plus className="h-3.5 w-3.5" /> {t("loadout.newProfile")}
                      </button>
                    </div>

                    <div className="flex gap-2">
                      <input
                        value={profileNameDraft}
                        onChange={(e) => setProfileNameDraft(e.target.value)}
                        placeholder={t("loadout.profileNamePlaceholder")}
                        className="flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:border-white/20 focus:outline-none"
                      />
                      <button
                        onClick={() => void save()}
                        disabled={saving}
                        className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                      >
                        {saving ? t("loadout.savingShort") : t("loadout.saveBtn")}
                      </button>
                    </div>
                  </div>
                  )}

                  {/* Bandeau image top-down du vaisseau */}
                  <ShipBanner ship={activeShipMeta} />

                  {/* Sections de slots */}
                  {editSlots.length === 0 ? (
                    <p className="text-sm text-white/40">
                      {t("loadout.noHardpoints2")}
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 gap-x-6 gap-y-4 lg:grid-cols-2">
                      {SECTIONS.map((section) => {
                        const rootEntries = editSlots
                          .map((s, idx) => ({ s, idx }))
                          .filter(({ s }) => section.types.includes(s.slotType) && isRootSlot(s))
                          // Tri par taille décroissante (convention erkul). Tri stable :
                          // les slots de même taille gardent l'ordre backend (gauche/droite…).
                          .sort((a, b) => b.s.slotSize - a.s.slotSize);
                        if (rootEntries.length === 0) return null;
                        // Compteur = items équipables (feuilles), hors conteneurs de tourelle :
                        // pour le Hammerhead on annonce 24 armes, pas 6 tourelles.
                        const leafCount = editSlots.filter(
                          (s) =>
                            section.types.includes(s.slotType) &&
                            s.slotType !== "TURRET" &&
                            (s.hardpointId == null ||
                              (childIdxByParent.get(s.hardpointId)?.length ?? 0) === 0),
                        ).length;
                        // Sections arborescentes (armes / tourelles / missiles) : rendu erkul
                        // via LoadoutNode (hiérarchie déroulée mount→arme, regroupement ×N).
                        // Systèmes / propulsion : feuilles simples via SlotTree.
                        const isTreeSection = section.types.some((tp) =>
                          ["WEAPON", "TURRET", "MISSILE"].includes(tp),
                        );
                        const families = section.types.includes("MISSILE")
                          ? ["MISSILE"]
                          : ["WEAPON", "TURRET"];
                        const groups = isTreeSection
                          ? []
                          : groupRoots(rootEntries, editSlots, section.disableGrouping);
                        return (
                          <div key={section.titleKey} className={section.fullWidth ? "lg:col-span-2" : ""}>
                            <CategorySection
                              title={t(section.titleKey)}
                              icon={section.icon}
                              count={leafCount}
                              variant={section.variant}
                              collapsible={section.collapsible}
                            >
                              {isTreeSection
                                ? rootEntries.map(({ idx }) => (
                                    <LoadoutNode
                                      key={idx}
                                      rep={idx}
                                      members={[idx]}
                                      mult={1}
                                      families={families}
                                      variant={section.variant}
                                      editSlots={editSlots}
                                      childIdxByParent={childIdxByParent}
                                      selectedIdx={modalIndex}
                                      onPick={openPicker}
                                    />
                                  ))
                                : groups.map((g) => (
                                    <SlotTree
                                      key={g.idx}
                                      idx={g.idx}
                                      variant={section.variant}
                                      editSlots={editSlots}
                                      childIdxByParent={childIdxByParent}
                                      selectedIdx={modalIndex}
                                      onSelect={isRented ? () => {} : (idx) => openPicker([idx])}
                                      groupCount={g.count}
                                    />
                                  ))}
                            </CategorySection>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Colonne droite ~35% */}
            <div className="lg:w-[35%]">
              <PerformanceSummary slots={editSlots} ship={activeShipMeta} />
            </div>
          </div>
        </>
      )}

      {modalSlot && (
        <ComponentPickerModal
          slot={modalSlot}
          shipDataId={activeShipDataId}
          isMount={
            modalSlot.hardpointId != null &&
            (childIdxByParent.get(modalSlot.hardpointId)?.length ?? 0) > 0
          }
          onPick={pickComponent}
          onClear={clearSlot}
          onClose={() => setModalMembers([])}
        />
      )}

      {blocker.state === "blocked" && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-6" onClick={() => blocker.reset?.()}>
          <div className="absolute inset-0 bg-black/70" />
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative z-10 w-full max-w-sm rounded-2xl border border-white/12 p-5"
            style={{ background: "rgba(13,17,23,0.98)" }}
          >
            <h3 className="mb-1.5 text-base font-semibold text-white">{t("loadout.leaveTitle")}</h3>
            <p className="mb-4 text-sm text-white/60">{t("loadout.leaveDesc")}</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => blocker.reset?.()}
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white/70 hover:bg-white/10"
              >
                {t("loadout.leaveCancel")}
              </button>
              <button
                onClick={() => blocker.proceed?.()}
                className="rounded-xl px-4 py-2 text-sm font-semibold text-white"
                style={{ background: "#f87171" }}
              >
                {t("loadout.leaveConfirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Sous-composants ── */

// Bandeau image top-down du vaisseau (réplique ShipBanner.tsx V1, ratio ~2.5:1).
function ShipBanner({ ship }: { ship: ShipMeta | null }) {
  // Image top-down Starjump résolue depuis le nom (le champ imageTopDownUrl reste null
  // côté backend). Repli sur l'image RSI puis sur le placeholder.
  const top = ship?.imageTopDownUrl ?? resolveShipTopDownUrl(ship?.name);
  const fallback = ship?.imageUrl ?? null;
  const [src, setSrc] = useState<string | null>(top ?? fallback);
  useEffect(() => {
    setSrc(top ?? fallback);
  }, [top, fallback]);

  return (
    <div
      className="relative mb-4 flex w-full items-center justify-center overflow-hidden rounded-2xl border border-white/10"
      style={{ aspectRatio: "2.5 / 1", background: "rgba(26,27,32,0.35)" }}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(circle at center, rgba(99,102,241,0.14) 0%, transparent 70%)",
        }}
      />
      {src ? (
        <img
          src={src}
          alt={ship?.name ?? ""}
          onError={() =>
            setSrc((cur) => (cur === top && fallback != null && fallback !== top ? fallback : null))
          }
          className="relative z-10 object-contain"
          style={{
            maxWidth: "90%",
            maxHeight: "90%",
            filter: "drop-shadow(0 0 24px rgba(99,102,241,0.25))",
          }}
        />
      ) : (
        <Rocket className="relative z-10 h-14 w-14" style={{ color: "#60a5fa", opacity: 0.2 }} />
      )}
    </div>
  );
}

// Regroupe les slots-racines identiques consécutifs (même composant) → badge (N×).
// Désactivé pour les Armes (comme V1). Les slots vides ne se groupent jamais.
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

function CategorySection({
  title,
  icon: Icon,
  count,
  variant,
  collapsible,
  children,
}: {
  title: string;
  icon: LucideIcon;
  count: number;
  variant: Variant;
  collapsible: boolean;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(true);
  const color = VARIANT_COLOR[variant];
  const borderColor = VARIANT_BORDER[variant];
  const isOpen = !collapsible || expanded;

  const header = (
    <>
      <Icon className="h-4 w-4 shrink-0" style={{ color }} />
      <span style={{ color }}>{title}</span>
      <span className="text-white/30">({count})</span>
      {collapsible && (
        <ChevronDown
          className="ml-auto h-4 w-4 transition-transform"
          style={{ color, opacity: 0.5, transform: expanded ? "rotate(180deg)" : "none" }}
        />
      )}
    </>
  );

  return (
    <div>
      {collapsible ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mb-3 flex w-full items-center gap-2 border-b pb-1 text-[11px] font-semibold uppercase tracking-wider transition-opacity hover:opacity-75"
          style={{ borderBottomColor: borderColor }}
        >
          {header}
        </button>
      ) : (
        <div
          className="mb-3 flex items-center gap-2 border-b pb-1 text-[11px] font-semibold uppercase tracking-wider"
          style={{ borderBottomColor: borderColor }}
        >
          {header}
        </div>
      )}
      <div
        style={{
          display: "grid",
          gridTemplateRows: isOpen ? "1fr" : "0fr",
          transition: "grid-template-rows 200ms ease",
        }}
      >
        <div style={{ overflow: "hidden" }}>
          <div className="space-y-2">{children}</div>
        </div>
      </div>
    </div>
  );
}

// Nom d'affichage d'un mount/tourelle/rack : nom du composant, suffixes " Mount" /
// " Gimbal Mount" retirés (ex. "VariPuck S3 Gimbal Mount" → "VariPuck S3"). Repli : portName.
function mountName(slot: SlotEdit): string {
  const n = slot.componentName;
  if (n && n.trim()) return n.replace(/\s+(Gimbal\s+)?Mount$/i, "").trim();
  return humanizePortName(slot.portName || slot.displayName || slot.slotType);
}

// En-tête de conteneur / mount / rack : affiche le nom du composant + taille + badge ×N.
// Cliquable (mount gimbal, tourelle distante, rack missiles) ou statique (tourelle habitée,
// sans composant échangeable). La section parente indique déjà s'il s'agit d'une tourelle.
function ContainerHeader({
  slot,
  variant,
  count,
  onClick,
  selected,
}: {
  slot: SlotEdit;
  variant: Variant;
  count: number;
  onClick?: () => void;
  selected?: boolean;
}) {
  const { t } = useTranslation();
  const color = VARIANT_COLOR[variant];
  // Tourelle habitée : libellé générique (pas de composant échangeable). Sinon nom du mount.
  const label = slot.slotType === "TURRET" ? t("loadout.turretManned") : mountName(slot);
  const inner = (
    <div className="flex min-w-0 items-center gap-2.5">
      <span
        className="shrink-0 rounded-md border border-white/5 px-1.5 py-0.5 font-mono text-[10px] font-semibold"
        style={{ background: "#26262e", color }}
      >
        S{slot.slotSize}
      </span>
      <span className="truncate text-[11px] font-semibold uppercase tracking-wider" style={{ color }}>
        {label}
      </span>
      {count > 1 && (
        <span className="shrink-0 text-[11px] font-bold" style={{ color }}>
          ×{count}
        </span>
      )}
    </div>
  );
  const baseStyle = {
    borderColor: VARIANT_BORDER[variant],
    background: "rgba(255,255,255,0.02)",
    borderLeft: `4px solid ${color}`,
    outline: selected ? `1px solid ${color}` : undefined,
  };
  if (!onClick) {
    return (
      <div className="flex items-center justify-between rounded-xl border p-2.5" style={baseStyle}>
        {inner}
      </div>
    );
  }
  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
      className="group flex cursor-pointer items-center justify-between rounded-xl border p-2.5 transition-colors hover:bg-white/[0.06]"
      style={baseStyle}
    >
      {inner}
      <Settings className="h-4 w-4 shrink-0 opacity-30 transition-opacity group-hover:opacity-100" style={{ color }} />
    </div>
  );
}

// Rend un slot + récursivement ses enfants (trait de liaison parent→enfant).
function SlotTree({
  idx,
  variant,
  editSlots,
  childIdxByParent,
  selectedIdx,
  onSelect,
  groupCount,
}: {
  idx: number;
  variant: Variant;
  editSlots: SlotEdit[];
  childIdxByParent: Map<number, number[]>;
  selectedIdx: number | null;
  onSelect: (idx: number) => void;
  groupCount?: number;
}) {
  const slot = editSlots[idx];
  const childIndices = slot.hardpointId != null ? childIdxByParent.get(slot.hardpointId) ?? [] : [];
  // SlotTree ne sert plus qu'aux sections non-armes (missiles : rack → missiles ; systèmes).
  // Les armes/tourelles/missiles sont rendues par LoadoutNode (rendu erkul).
  return (
    <div>
      <SlotRow
        slot={slot}
        variant={variant}
        selected={idx === selectedIdx}
        onClick={() => onSelect(idx)}
        groupCount={groupCount}
      />
      {childIndices.length > 0 && (
        <div
          className="ml-10 mt-1 space-y-1 pl-3"
          style={{ borderLeft: `2px solid ${VARIANT_LINE[variant]}` }}
        >
          {childIndices.map((ci) => (
            <SlotTree
              key={ci}
              idx={ci}
              variant={variant}
              editSlots={editSlots}
              childIdxByParent={childIdxByParent}
              selectedIdx={selectedIdx}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SlotRow({
  slot,
  variant,
  selected,
  onClick,
  groupCount,
}: {
  slot: SlotEdit;
  variant: Variant;
  selected: boolean;
  onClick: () => void;
  groupCount?: number;
}) {
  const { t } = useTranslation();
  const color = VARIANT_COLOR[variant];
  const isEmpty = !slot.componentName;
  const countBadge = groupCount != null && groupCount > 1 ? ` (${groupCount}×)` : "";

  // Sous-titre : "TYPE D'ARME | PORT" (rempli) ou "PORT" (vide), uppercase atténué.
  const parts: string[] = [];
  if (!isEmpty) {
    const wt = deriveWeaponType(slot.componentClassName);
    if (wt) parts.push(wt);
    if (slot.portName) parts.push(humanizePortName(slot.portName));
  } else if (slot.portName) {
    parts.push(humanizePortName(slot.portName));
  } else {
    parts.push(slot.slotType.replace(/_/g, " "));
  }
  const subtitle = parts.join(" | ");

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
      className="group flex cursor-pointer items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] p-3 transition-colors hover:bg-white/[0.07]"
      style={{ borderLeft: `4px solid ${color}`, outline: selected ? `1px solid ${color}` : undefined }}
    >
      <div className="flex min-w-0 items-center gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-white/5"
          style={{ background: "#26262e" }}
        >
          <span className="font-mono text-xs font-semibold" style={{ color }}>
            S{slot.slotSize}
          </span>
        </div>
        <div className="min-w-0">
          <div
            className="truncate text-sm font-semibold"
            style={{ color: isEmpty ? "rgba(255,255,255,0.3)" : "#fff" }}
          >
            {isEmpty ? t("loadout.slotEmpty") : `${slot.componentName}${countBadge}`}
          </div>
          <div
            className="mt-0.5 truncate text-[10px] uppercase"
            style={{ color, opacity: 0.6, letterSpacing: "0.05em" }}
          >
            {subtitle}
          </div>
        </div>
      </div>
      <Settings
        className="h-[18px] w-[18px] shrink-0 opacity-40 transition-opacity group-hover:opacity-100"
        style={{ color }}
      />
    </div>
  );
}

// Ligne feuille (canon ou missile) : nom du composant + taille + ×N + stat (dps cumulé).
function LeafRow({
  slot,
  variant,
  count,
  stat,
  selected,
  onClick,
}: {
  slot: SlotEdit;
  variant: Variant;
  count: number;
  stat: number | null;
  selected: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  const color = VARIANT_COLOR[variant];
  const isEmpty = !slot.componentName;
  const parts: string[] = [];
  if (!isEmpty) {
    const wt = deriveWeaponType(slot.componentClassName);
    if (wt) parts.push(wt);
  }
  if (slot.portName) parts.push(humanizePortName(slot.portName));
  const subtitle = parts.join(" | ");
  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
      className="group flex cursor-pointer items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] p-3 transition-colors hover:bg-white/[0.07]"
      style={{ borderLeft: `4px solid ${color}`, outline: selected ? `1px solid ${color}` : undefined }}
    >
      <div className="flex min-w-0 items-center gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-white/5"
          style={{ background: "#26262e" }}
        >
          <span className="font-mono text-xs font-semibold" style={{ color }}>
            S{slot.slotSize}
          </span>
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold" style={{ color: isEmpty ? "rgba(255,255,255,0.3)" : "#fff" }}>
            {isEmpty ? t("loadout.slotEmpty") : slot.componentName}
            {count > 1 && <span style={{ color, opacity: 0.85 }}> ×{count}</span>}
          </div>
          <div className="mt-0.5 truncate text-[10px] uppercase" style={{ color, opacity: 0.6, letterSpacing: "0.05em" }}>
            {subtitle}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {stat != null && stat > 0 && (
          <span className="font-mono text-xs font-semibold" style={{ color: "#fff", opacity: 0.85 }}>
            {Math.round(stat)} dps
          </span>
        )}
        <Settings className="h-[18px] w-[18px] opacity-40 transition-opacity group-hover:opacity-100" style={{ color }} />
      </div>
    </div>
  );
}

/* ── Helpers d'arbre (rendu erkul : hiérarchie déroulée + regroupement ×N) ── */

// Enfants d'un slot appartenant aux familles de la section (WEAPON/TURRET, ou MISSILE).
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
function LoadoutNode({
  rep,
  members,
  mult,
  families,
  variant,
  editSlots,
  childIdxByParent,
  selectedIdx,
  onPick,
}: {
  rep: number;
  members: number[];
  mult: number;
  families: string[];
  variant: Variant;
  editSlots: SlotEdit[];
  childIdxByParent: Map<number, number[]>;
  selectedIdx: number | null;
  onPick: (idxs: number[]) => void;
}) {
  const slot = editSlots[rep];
  const count = members.length * mult;
  const isMissile = families[0] === "MISSILE";
  const selected = selectedIdx != null && members.includes(selectedIdx);

  const kids = treeChildren(rep, editSlots, childIdxByParent, families)
    .slice()
    .sort((a, b) => editSlots[b].slotSize - editSlots[a].slotSize);
  const isLeaf = kids.length === 0;

  // Feuille : canon ou missile.
  if (isLeaf) {
    const editIdxs = isMissile ? members : [rep]; // missile = groupe entier ; arme = un seul
    return (
      <LeafRow
        slot={slot}
        variant={variant}
        count={count}
        stat={slot.realDps != null ? slot.realDps * count : null}
        selected={selected}
        onClick={() => onPick(editIdxs)}
      />
    );
  }

  // Conteneur / mount / rack : en-tête + enfants regroupés.
  // Cliquable sauf tourelle habitée (type TURRET sans composant échangeable).
  const clickable = slot.slotType !== "TURRET";
  const childGroups = groupSiblings(kids, editSlots, childIdxByParent, families);
  return (
    <div>
      <ContainerHeader
        slot={slot}
        variant={variant}
        count={count}
        selected={selected}
        onClick={clickable ? () => onPick([rep]) : undefined}
      />
      <div className="ml-6 mt-1.5 space-y-1.5 pl-3" style={{ borderLeft: `2px solid ${VARIANT_LINE[variant]}` }}>
        {childGroups.map((g) => (
          <LoadoutNode
            key={g.rep}
            rep={g.rep}
            members={g.members}
            mult={count}
            families={families}
            variant={variant}
            editSlots={editSlots}
            childIdxByParent={childIdxByParent}
            selectedIdx={selectedIdx}
            onPick={onPick}
          />
        ))}
      </div>
    </div>
  );
}

// Agrégation fidèle de loadoutStats.ts V1 (sommes des stats réelles équipées).
// editSlots est déjà à plat (pré-ordre incluant les enfants) → pas de récursion.
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

function StatSection({
  label,
  mainValue,
  mainColor,
  rows,
  progressPercent,
}: {
  label: string;
  mainValue: string;
  mainColor: string;
  rows: Array<{ label: string; value: string; color?: string }>;
  progressPercent?: number;
}) {
  return (
    <div>
      <div className="mb-2 flex items-end justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-white/50">
          {label}
        </span>
        <span className="font-mono text-sm font-bold" style={{ color: mainColor }}>
          {mainValue}
        </span>
      </div>
      <div className="space-y-2 rounded-xl border border-white/10 bg-white/[0.02] p-3">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between text-[11px]">
            <span className="text-white/70">{row.label}</span>
            <span className="font-mono" style={{ color: row.color ?? mainColor }}>
              {row.value}
            </span>
          </div>
        ))}
        {progressPercent !== undefined && (
          <div
            className="h-2 overflow-hidden rounded-full"
            style={{ background: "rgba(255,255,255,0.08)" }}
          >
            <div
              className="h-full rounded-full transition-[width] duration-500"
              style={{
                width: `${Math.min(100, Math.max(0, progressPercent))}%`,
                background: mainColor,
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function PerformanceSummary({ slots, ship }: { slots: SlotEdit[]; ship: ShipMeta | null }) {
  const { t } = useTranslation();
  const stats = aggregateLoadoutStats(slots);

  const dpsDisplay = stats.totalDps > 0 ? `${Math.round(stats.totalDps)} DPS` : "— DPS";
  const shieldDisplay = stats.totalShieldHp > 0 ? `${Math.round(stats.totalShieldHp)} HP` : "— HP";
  const powerDisplay = stats.totalPowerDraw > 0 ? `${Math.round(stats.totalPowerDraw)} kW/s` : "— kW/s";

  const dpsProgress = Math.min(100, (stats.totalDps / 2000) * 100);
  const shieldProgress = Math.min(100, (stats.totalShieldHp / 6000) * 100);
  const powerProgress =
    stats.totalPowerOutput > 0
      ? Math.min(100, (stats.totalPowerDraw / stats.totalPowerOutput) * 100)
      : stats.totalPowerDraw > 0
        ? Math.min(100, (stats.totalPowerDraw / 500) * 100)
        : 0;

  const sigLevel = getSignatureLevel(ship?.crossSection ?? null, t);

  const powerMarginStr =
    stats.powerMargin != null
      ? `${stats.powerMargin > 0 ? "+" : ""}${stats.powerMargin.toFixed(1)}%`
      : "—";
  const inDeficit = stats.powerMargin != null && stats.powerMargin < 0;
  const powerMarginColor =
    stats.powerMargin == null ? undefined : stats.powerMargin >= 0 ? "#34d399" : "#f87171";
  // En déficit, toute la section ÉNERGIE (valeur principale + barre) passe en rouge.
  const powerSectionColor = inDeficit ? "#f87171" : "#60a5fa";

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-white/70">
        {t("loadout.performance")}
      </h2>
      <div className="space-y-5">
        <StatSection
          label={t("loadout.statOffensive")}
          mainValue={dpsDisplay}
          mainColor="#60a5fa"
          rows={[
            {
              label: t("loadout.rowAlphaDamage"),
              value: stats.totalAlphaDamage > 0 ? fmtStat(stats.totalAlphaDamage) : "—",
            },
            { label: t("loadout.rowBurstDps"), value: "—" },
          ]}
          progressPercent={dpsProgress}
        />

        <StatSection
          label={t("loadout.statDefensive")}
          mainValue={shieldDisplay}
          mainColor="#fbbf24"
          rows={[
            {
              label: t("loadout.rowShieldRegen"),
              value: stats.shieldRegenRate > 0 ? `${fmtStat(stats.shieldRegenRate)} HP/s` : "—",
              color: "#fbbf24",
            },
            {
              label: t("loadout.rowShieldDelay"),
              value: stats.shieldDelayDmg != null ? `${stats.shieldDelayDmg.toFixed(1)} s` : "—",
              color: "#fbbf24",
            },
          ]}
          progressPercent={shieldProgress}
        />

        <StatSection
          label={t("loadout.statRadarSig")}
          mainValue={sigLevel}
          mainColor="rgba(255,255,255,0.8)"
          rows={[
            {
              label: t("loadout.rowEmSignature"),
              value: ship?.emSignature != null ? fmtStat(ship.emSignature) : "—",
              color: "#93ccff",
            },
            {
              label: t("loadout.rowIrSignature"),
              value: ship?.irSignature != null ? fmtStat(ship.irSignature) : "—",
              color: "#f87171",
            },
            {
              label: t("loadout.rowCrossSection"),
              value: ship?.crossSection != null ? fmtStat(ship.crossSection) : "—",
            },
          ]}
        />

        <StatSection
          label={t("loadout.statEnergy")}
          mainValue={powerDisplay}
          mainColor={powerSectionColor}
          rows={[
            {
              label: t("loadout.rowOutput"),
              value: stats.totalPowerOutput > 0 ? `${fmtStat(stats.totalPowerOutput)} kW` : "—",
            },
            { label: t("loadout.rowMargin"), value: powerMarginStr, color: powerMarginColor },
          ]}
          progressPercent={powerProgress}
        />
      </div>
    </div>
  );
}

// Mini-modale de détail d'acquisition (clic sur 🛒/🔧/📦) : lieux d'achat, recette/ingrédients,
// ou vaisseaux. Bouton « Afficher en détails » → onglet associé (craft / catalogue) ciblé.
type AcqDetailData = {
  buy: Array<{ terminal: string | null; price: number | null }>;
  craft: { blueprintId: string; timeSeconds: number | null; ingredients: Array<{ name: string | null; qty: number | null }> } | null;
  ships: Array<string | null>;
};
function AcquisitionDetailModal({
  comp,
  kind,
  onClose,
}: {
  comp: ComponentRow;
  kind: "buy" | "craft" | "stock";
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [data, setData] = useState<AcqDetailData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    invoke<AcqDetailData>("get_acquisition_detail", { className: comp.className, name: comp.name })
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [comp.className, comp.name]);

  const fmtT = (s: number | null) =>
    s == null ? null : s >= 60 ? `${Math.round(s / 60)} min` : `${Math.round(s)} s`;

  const title =
    kind === "buy" ? t("loadout.acqBuy") : kind === "craft" ? t("loadout.acqCraft") : t("loadout.acqStock");
  const Icon = kind === "buy" ? ShoppingCart : kind === "craft" ? Hammer : Package;
  const color = kind === "buy" ? "#34d399" : kind === "craft" ? "#fbbf24" : "#93c5fd";

  // Navigation vers l'onglet associé, ciblé sur l'item.
  function goDetails() {
    if (kind === "craft" && data?.craft) {
      navigate("/crafting", { state: { blueprintId: data.craft.blueprintId } });
    } else if (kind === "buy") {
      navigate("/catalogue", { state: { tab: "items", search: comp.name } });
    } else if (kind === "stock") {
      const firstShip = data?.ships.find(Boolean) ?? null;
      navigate("/catalogue", { state: { tab: "vehicles", search: firstShip ?? "" } });
    }
  }
  const canGoDetails =
    (kind === "craft" && !!data?.craft) ||
    (kind === "buy" && (data?.buy.length ?? 0) > 0) ||
    (kind === "stock" && (data?.ships.length ?? 0) > 0);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-6" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative z-10 flex max-h-[70vh] w-full flex-col overflow-hidden rounded-2xl border backdrop-blur-2xl"
        style={{ maxWidth: "460px", background: "rgba(13,17,23,0.98)", borderColor: "rgba(255,255,255,0.12)" }}
      >
        <div className="flex items-center gap-2.5 border-b border-white/10 px-5 py-3.5">
          <Icon className="h-4 w-4 shrink-0" style={{ color }} />
          <span className="text-sm font-semibold" style={{ color }}>
            {title}
          </span>
          <span className="truncate text-xs text-white/50">· {comp.name}</span>
          <button onClick={onClose} className="ml-auto rounded-lg p-1 text-white/50 hover:bg-white/10">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 text-sm">
          {loading ? (
            <div className="flex items-center gap-2 text-white/40">
              <Loader2 className="h-4 w-4 animate-spin" /> {t("loadout.loadingShort")}
            </div>
          ) : kind === "buy" ? (
            (data?.buy.length ?? 0) === 0 ? (
              <p className="text-white/40">{t("loadout.acqNotBuy")}</p>
            ) : (
              <ul className="space-y-1.5">
                {data!.buy.map((b, i) => (
                  <li key={i} className="flex items-center justify-between gap-3">
                    <span className="truncate text-white/70">{b.terminal ?? "—"}</span>
                    <span className="shrink-0 font-mono text-white/90">
                      {b.price != null ? `${b.price.toLocaleString("fr-FR")} aUEC` : "—"}
                    </span>
                  </li>
                ))}
              </ul>
            )
          ) : kind === "craft" ? (
            !data?.craft ? (
              <p className="text-white/40">{t("loadout.acqNotCraft")}</p>
            ) : (
              <div className="space-y-3">
                {fmtT(data.craft.timeSeconds) && (
                  <div className="text-white/70">
                    {t("loadout.acqCraftTime")} <span className="text-white/90">{fmtT(data.craft.timeSeconds)}</span>
                  </div>
                )}
                <div>
                  <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/40">
                    {data.craft.ingredients.length} {t("loadout.acqCraftIngr")}
                  </div>
                  <ul className="space-y-1.5">
                    {data.craft.ingredients.map((ing, i) => (
                      <li key={i} className="flex items-center justify-between gap-3">
                        <span className="truncate text-white/70">{ing.name ?? "—"}</span>
                        {ing.qty != null && <span className="shrink-0 font-mono text-white/90">×{ing.qty}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )
          ) : (data?.ships.length ?? 0) === 0 ? (
            <p className="text-white/40">{t("loadout.acqNotStock")}</p>
          ) : (
            <ul className="space-y-1.5">
              {data!.ships.filter(Boolean).map((s, i) => (
                <li key={i} className="text-white/70">
                  {s}
                </li>
              ))}
            </ul>
          )}
        </div>

        {canGoDetails && (
          <div className="flex justify-end border-t border-white/10 px-5 py-3">
            <button
              onClick={goDetails}
              className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            >
              {t("loadout.acqShowDetails")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ComponentPickerModal({
  slot,
  shipDataId,
  isMount,
  onPick,
  onClear,
  onClose,
}: {
  slot: SlotEdit;
  shipDataId: number | null;
  isMount: boolean;
  onPick: (c: ComponentRow) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [components, setComponents] = useState<ComponentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  // Filtre d'acquisition (Lot 5) : tous / achetables / craftables / stock vaisseau.
  const [acqFilter, setAcqFilter] = useState<"all" | "buy" | "craft" | "stock">("all");
  // Mini-modale de détail d'acquisition (clic sur une icône 🛒/🔧/📦).
  const [acqDetail, setAcqDetail] = useState<{ comp: ComponentRow; kind: "buy" | "craft" | "stock" } | null>(null);
  // Tri d'affichage (pur front). null = état GROUPÉ par sous-type (défaut à l'ouverture).
  const [sortKey, setSortKey] = useState<keyof ComponentRow | null>(null);
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // Repart en état groupé (sans tri, sans filtre) à chaque changement de slot / réouverture.
    setSortKey(null);
    setSortDir("desc");
    setAcqFilter("all");
    // Matching fin (Lot 2) : résolu côté Rust à partir du (shipDataId, portName) du slot —
    // type, taille bornée, subType et famille de required_tags (réplique getCompatible V1).
    const query: Promise<ComponentRow[]> =
      shipDataId != null && (slot.portName || slot.hardpointId != null)
        ? invoke<ComponentRow[]>("get_components_for_slot", {
            shipDataId,
            portName: slot.portName,
            // Cible le hardpoint exact (portName non unique) ; null pour anciens profils.
            hardpointId: slot.hardpointId ?? null,
          })
        : Promise.resolve([]);
    query
      .then((data) => {
        if (cancelled) return;
        // Masque les WeaponDefensive (contre-mesures) — réplique isHiddenFromPicker V1.
        const visible = data.filter((c) => c.scWikiType !== "WeaponDefensive");
        // Dédup par NOM affiché : la base contient de nombreuses variantes internes au même
        // nom (ex. "VariPuck S3 Gimbal Mount" ×11, "Remote Turret" ×78, une par vaisseau).
        // On garde une seule entrée par nom, en privilégiant le className le plus générique
        // (le plus court → ex. Mount_Gimbal_S3 plutôt que Mount_Gimbal_S3_Perseus_Bottom).
        const byName = new Map<string, ComponentRow>();
        for (const c of visible) {
          const prev = byName.get(c.name);
          if (!prev || c.className.length < prev.className.length) byName.set(c.name, c);
        }
        setComponents(Array.from(byName.values()));
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [shipDataId, slot.portName, slot.hardpointId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return components.filter((c) => {
      if (acqFilter === "buy" && c.buyable !== 1) return false;
      if (acqFilter === "craft" && c.craftable !== 1) return false;
      if (acqFilter === "stock" && !c.stockShips) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        (c.manufacturer?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [components, search, acqFilter]);

  const spec = SLOT_TYPE_SPECS[slot.slotType] ?? [];
  const portLabel = slot.portName ? humanizePortName(slot.portName) : slot.slotType.replace(/_/g, " ");

  // Groupe les armes par type (LASER/BALLISTIC…) ; liste plate pour les autres types.
  const grouped: Array<{ group: string | null; items: ComponentRow[] }> =
    slot.slotType === "WEAPON"
      ? (() => {
          const map = new Map<string, ComponentRow[]>();
          for (const c of filtered) {
            const key = deriveWeaponType(c.className) ?? t("loadout.pickerGroupOther");
            const arr = map.get(key) ?? [];
            arr.push(c);
            map.set(key, arr);
          }
          return Array.from(map.entries()).map(([group, items]) => ({ group, items }));
        })()
      : [{ group: null, items: filtered }];

  // Cycle de tri : autre colonne → décroissant ; même colonne : décroissant → croissant
  // → neutre (retour à l'état groupé).
  function handleSort(col: keyof ComponentRow) {
    if (sortKey !== col) {
      setSortKey(col);
      setSortDir("desc");
    } else if (sortDir === "desc") {
      setSortDir("asc");
    } else {
      setSortKey(null);
    }
  }

  // Liste à plat triée (quand un tri est actif). null si état groupé.
  const sortedList = useMemo<ComponentRow[] | null>(() => {
    if (sortKey == null) return null;
    const getVal = (c: ComponentRow): number | null =>
      sortKey === "size"
        ? c.size
        : sortKey === "grade"
          ? gradeRank(c.grade)
          : getStat(c, sortKey);
    return filtered
      .map((c, i) => ({ c, i }))
      .sort((a, b) => {
        const va = getVal(a.c);
        const vb = getVal(b.c);
        if (va == null && vb == null) return a.i - b.i; // stable
        if (va == null) return 1; // valeurs manquantes toujours en fin
        if (vb == null) return -1;
        if (va !== vb) return sortDir === "desc" ? vb - va : va - vb;
        return a.i - b.i; // tri stable à valeur égale
      })
      .map((x) => x.c);
  }, [filtered, sortKey, sortDir]);

  // En-tête de colonne cliquable avec indicateur de tri.
  function sortHeader(label: string, col: keyof ComponentRow, align: "left" | "right") {
    const active = sortKey === col;
    return (
      <button
        type="button"
        onClick={() => handleSort(col)}
        className={[
          "flex items-center gap-0.5 text-[9px] font-semibold uppercase tracking-wider transition-colors",
          align === "right" ? "justify-end" : "",
          active ? "text-white/80" : "text-white/40 hover:text-white/70",
        ].join(" ")}
        style={align === "right" ? { minWidth: "48px" } : undefined}
      >
        <span>{label}</span>
        {active &&
          (sortDir === "desc" ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronUp className="h-3 w-3" />
          ))}
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative z-10 flex max-h-[80vh] w-full flex-col overflow-hidden rounded-2xl border backdrop-blur-2xl"
        style={{
          maxWidth: "680px",
          background: "rgba(13,17,23,0.97)",
          borderColor: "rgba(96,165,250,0.2)",
        }}
      >
        {/* En-tête */}
        <div className="shrink-0 border-b border-white/10 px-6 py-4">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-white/40">
            {t("loadout.pickerConfigTitle")}
          </div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-base uppercase tracking-wide" style={{ color: "#60a5fa" }}>
              {portLabel}
            </span>
            <span
              className="rounded px-2 py-0.5 text-[10px] font-semibold uppercase"
              style={{
                background: "rgba(96,165,250,0.12)",
                border: "1px solid rgba(96,165,250,0.25)",
                color: "#60a5fa",
              }}
            >
              S{slot.slotSize}
            </span>
            <span className="text-[10px] font-semibold uppercase text-white/40">
              {t("loadout.pickerComponentCount", { count: filtered.length })}
            </span>
            {sortKey != null && (
              <button
                onClick={() => setSortKey(null)}
                className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-white/60 transition-colors hover:bg-white/10"
                title={t("loadout.pickerRegroupTitle")}
              >
                {t("loadout.pickerRegroup")}
              </button>
            )}
            {isMount && (
              <button
                onClick={onClear}
                className="ml-auto rounded-full border px-3 py-1 text-[10px] font-semibold uppercase transition-opacity hover:opacity-90"
                style={{
                  color: "rgba(255,170,80,0.95)",
                  border: "1px solid rgba(255,136,0,0.3)",
                  background: "rgba(255,136,0,0.08)",
                }}
              >
                {t("loadout.pickerLeaveEmpty")}
              </button>
            )}
            <button
              onClick={onClose}
              aria-label={t("loadout.pickerClose")}
              className={`${isMount ? "" : "ml-auto"} rounded-lg p-1 text-white/50 hover:bg-white/10`}
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          {isMount && (
            <div className="mt-1.5 text-[10px] font-semibold uppercase tracking-widest" style={{ color: "rgba(255,136,0,0.75)" }}>
              {t("loadout.pickerMountHint", { mount: slot.slotType === "MISSILE" ? t("loadout.pickerMissileRack") : t("loadout.pickerCarrier") })}
            </div>
          )}
        </div>

        {/* Recherche */}
        <div className="shrink-0 px-6 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("loadout.pickerSearchPlaceholder")}
              className="w-full rounded-full border border-white/10 bg-white/5 py-2 pl-9 pr-4 text-sm text-white placeholder:text-white/40 focus:border-white/20 focus:outline-none"
            />
          </div>
          {/* Filtres d'acquisition (Lot 5) : tous / achetables / craftables */}
          <div className="mt-2.5 flex items-center gap-2">
            {([
              { key: "all", label: t("loadout.acqAll"), icon: null },
              { key: "buy", label: t("loadout.acqBuy"), icon: ShoppingCart },
              { key: "craft", label: t("loadout.acqCraft"), icon: Hammer },
              { key: "stock", label: t("loadout.acqStock"), icon: Package },
            ] as const).map((chip) => {
              const active = acqFilter === chip.key;
              const Icon = chip.icon;
              return (
                <button
                  key={chip.key}
                  type="button"
                  onClick={() => setAcqFilter(chip.key)}
                  className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors"
                  style={{
                    borderColor: active ? "rgba(96,165,250,0.5)" : "rgba(255,255,255,0.1)",
                    background: active ? "rgba(96,165,250,0.15)" : "transparent",
                    color: active ? "#93c5fd" : "rgba(255,255,255,0.55)",
                  }}
                >
                  {Icon && <Icon className="h-3.5 w-3.5" />}
                  {chip.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* En-têtes de colonnes */}
        {!loading && filtered.length > 0 && (
          <div
            className="flex shrink-0 items-center gap-4 px-6 py-1.5"
            style={{
              borderTop: "1px solid rgba(255,255,255,0.05)",
              borderBottom: "1px solid rgba(255,255,255,0.05)",
              background: "rgba(0,0,0,0.2)",
            }}
          >
            <div className="flex-1 text-[9px] font-semibold uppercase tracking-wider text-white/40">
              {t("loadout.pickerColComponent")}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {sortHeader(t("loadout.pickerColSize"), "size", "left")}
              {sortHeader(t("loadout.pickerColGrade"), "grade", "left")}
            </div>
            <div className="flex shrink-0 items-center gap-5">
              {spec.map((s) => (
                <span key={s.key}>{sortHeader(t(s.labelKey), s.key, "right")}</span>
              ))}
            </div>
          </div>
        )}

        {/* Corps */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-[11px] uppercase tracking-widest text-white/40">
              <Loader2 className="h-4 w-4 animate-spin" /> {t("loadout.loadingShort")}
            </div>
          ) : error ? (
            <p className="px-6 py-4 text-sm text-red-300">{error}</p>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-white/40">
              <PackageOpen className="h-9 w-9 opacity-25" />
              <span className="text-[11px] uppercase tracking-widest">{t("loadout.pickerNoCompatible")}</span>
            </div>
          ) : sortedList != null ? (
            // Tri actif : liste à plat triée (regroupement désactivé).
            sortedList.map((c) => (
              <PickerRow
                key={c.className}
                comp={c}
                specs={spec}
                current={slot.componentClassName}
                onSelect={() => onPick(c)}
                onShowAcq={(comp, kind) => setAcqDetail({ comp, kind })}
              />
            ))
          ) : (
            grouped.map(({ group, items }) => (
              <div key={group ?? "_flat"}>
                {group && (
                  <div
                    className="sticky top-0 px-6 py-2 text-[10px] font-semibold uppercase tracking-widest"
                    style={{
                      color: "rgba(96,165,250,0.6)",
                      background: "rgba(13,17,23,0.97)",
                      borderBottom: "1px solid rgba(96,165,250,0.07)",
                    }}
                  >
                    {group}
                  </div>
                )}
                {items.map((c) => (
                  <PickerRow
                    key={c.className}
                    comp={c}
                    specs={spec}
                    current={slot.componentClassName}
                    onSelect={() => onPick(c)}
                    onShowAcq={(comp, kind) => setAcqDetail({ comp, kind })}
                  />
                ))}
              </div>
            ))
          )}
        </div>

        {/* Pied : vider le slot */}
        <div className="shrink-0 border-t border-white/10 px-6 py-3">
          <button
            onClick={onClear}
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white/70 hover:bg-white/10"
          >
            {t("loadout.pickerClearSlot")}
          </button>
        </div>
      </div>

      {acqDetail && (
        <AcquisitionDetailModal comp={acqDetail.comp} kind={acqDetail.kind} onClose={() => setAcqDetail(null)} />
      )}
    </div>
  );
}

function PickerRow({
  comp,
  specs,
  current,
  onSelect,
  onShowAcq,
}: {
  comp: ComponentRow;
  specs: StatSpec[];
  current: string | null;
  onSelect: () => void;
  onShowAcq: (comp: ComponentRow, kind: "buy" | "craft" | "stock") => void;
}) {
  const { t } = useTranslation();
  const isActive = comp.className != null && comp.className === current;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => e.key === "Enter" && onSelect()}
      className="flex w-full cursor-pointer items-center gap-4 px-6 py-3 text-left transition-colors hover:bg-white/[0.04]"
      style={{
        background: isActive ? "rgba(96,165,250,0.10)" : undefined,
        borderBottom: "1px solid rgba(255,255,255,0.04)",
        borderLeft: `2px solid ${isActive ? "#60a5fa" : "transparent"}`,
      }}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-sm" style={{ color: isActive ? "#60a5fa" : "#fff" }}>
          {comp.name}
        </div>
        {(comp.manufacturer || comp.class) && (
          <div className="mt-0.5 truncate text-[10px] text-white/40">
            {[comp.manufacturer, comp.class].filter(Boolean).join(" · ")}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white/60"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
        >
          S{comp.size}
        </span>
        {comp.grade && (
          <span
            className="rounded px-1.5 py-0.5 text-center text-[10px] font-semibold"
            style={{ color: "#000", background: gradeColor(comp.grade), minWidth: "22px" }}
          >
            {comp.grade}
          </span>
        )}
      </div>
      {/* Acquisition (Lot 5) : icônes cliquables → mini-modale détail. Grisé si donnée inconnue. */}
      <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <AcqIcon
          Icon={ShoppingCart}
          on={comp.buyable === 1}
          color="#34d399"
          label={comp.buyable === 1 ? t("loadout.acqBuy") : t("loadout.acqNotBuy")}
          onShow={() => onShowAcq(comp, "buy")}
        />
        <AcqIcon
          Icon={Hammer}
          on={comp.craftable === 1}
          color="#fbbf24"
          label={comp.craftable === 1 ? t("loadout.acqCraft") : t("loadout.acqNotCraft")}
          onShow={() => onShowAcq(comp, "craft")}
        />
        <AcqIcon
          Icon={Package}
          on={!!comp.stockShips}
          color="#93c5fd"
          label={comp.stockShips ? t("loadout.acqStock") : t("loadout.acqNotStock")}
          onShow={() => onShowAcq(comp, "stock")}
        />
      </div>
      <div className="flex shrink-0 items-center gap-5">
        {specs.map((s) => (
          <div key={s.key} className="text-right" style={{ minWidth: "48px" }}>
            <div className="font-mono text-[12px] text-white">{formatStat(getStat(comp, s.key), s)}</div>
            <div className="text-[9px] font-semibold uppercase tracking-wider text-white/40">
              {t(s.labelKey)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Icône d'acquisition cliquable (agrandie). Active (colorée, ouvre le détail) si la source
// existe ; sinon grisée et inerte. stopPropagation pour ne pas sélectionner le composant.
function AcqIcon({
  Icon,
  on,
  color,
  label,
  onShow,
}: {
  Icon: LucideIcon;
  on: boolean;
  color: string;
  label: string;
  onShow: () => void;
}) {
  if (!on) {
    return (
      <span title={label} className="flex h-7 w-7 items-center justify-center">
        <Icon className="h-[18px] w-[18px]" style={{ color: "rgba(255,255,255,0.16)" }} />
      </span>
    );
  }
  return (
    <button
      type="button"
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onShow();
      }}
      className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-white/10"
    >
      <Icon className="h-[18px] w-[18px]" style={{ color }} />
    </button>
  );
}
