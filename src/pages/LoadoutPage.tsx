import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ChevronDown,
  ChevronUp,
  Crosshair,
  Gauge,
  Loader2,
  PackageOpen,
  Plus,
  Rocket,
  Search,
  Settings,
  Shield,
  X,
  type LucideIcon,
} from "lucide-react";

/* ── Types ── */

type FleetShip = {
  id: number;
  name: string;
  manufacturer: string;
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
};

type Variant = "primary" | "secondary" | "tertiary";

// Découpage V1 : Armes + Missiles pleine largeur (primary), Systèmes (secondary) et
// Propulsion (tertiary) côte à côte. Armes : pas de regroupement (comme V1).
const SECTIONS: Array<{
  title: string;
  types: string[];
  icon: LucideIcon;
  variant: Variant;
  collapsible: boolean;
  disableGrouping: boolean;
  fullWidth: boolean;
}> = [
  { title: "Armes", types: ["WEAPON"], icon: Crosshair, variant: "primary", collapsible: true, disableGrouping: true, fullWidth: true },
  { title: "Missiles", types: ["MISSILE"], icon: Rocket, variant: "primary", collapsible: true, disableGrouping: false, fullWidth: true },
  { title: "Systèmes", types: ["SHIELD", "POWER_PLANT"], icon: Shield, variant: "secondary", collapsible: false, disableGrouping: false, fullWidth: false },
  { title: "Propulsion", types: ["QUANTUM_DRIVE", "COOLER"], icon: Gauge, variant: "tertiary", collapsible: false, disableGrouping: false, fullWidth: false },
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
type StatSpec = { key: keyof ComponentRow; label: string; unit?: string; precision?: number };
const SLOT_TYPE_SPECS: Record<string, StatSpec[]> = {
  WEAPON: [
    { key: "dps", label: "DPS", precision: 1 },
    { key: "alphaDamage", label: "Alpha", precision: 0 },
    { key: "weaponFireRate", label: "RPM", precision: 0 },
    { key: "range", label: "Portée", unit: "m", precision: 0 },
  ],
  MISSILE: [
    { key: "missileDamage", label: "Dmg", precision: 0 },
    { key: "missileLockTime", label: "Lock", unit: "s", precision: 1 },
    { key: "missileSpeed", label: "Vit", unit: "m/s", precision: 0 },
    { key: "missileLockRangeMax", label: "Portée", unit: "m", precision: 0 },
  ],
  SHIELD: [
    { key: "shieldHp", label: "Pool", unit: "hp", precision: 0 },
    { key: "shieldRegenRate", label: "Régén", unit: "/s", precision: 1 },
    { key: "shieldDelayDmg", label: "Délai", unit: "s", precision: 1 },
    { key: "powerDraw", label: "Conso", unit: "kW", precision: 0 },
  ],
  POWER_PLANT: [
    { key: "powerOutput", label: "Sortie", unit: "kW", precision: 0 },
    { key: "powerDraw", label: "Conso", unit: "kW", precision: 0 },
    { key: "emMax", label: "EM", precision: 0 },
    { key: "heatGen", label: "Chaleur", precision: 0 },
  ],
  COOLER: [
    { key: "heatGen", label: "Refroid.", precision: 0 },
    { key: "powerDraw", label: "Conso", unit: "kW", precision: 0 },
    { key: "emMax", label: "EM", precision: 0 },
  ],
  QUANTUM_DRIVE: [
    { key: "qtDriveSpeed", label: "Vit QT", unit: "Mm/s", precision: 0 },
    { key: "qtSpoolTime", label: "Spool", unit: "s", precision: 1 },
    { key: "qtFuelRate", label: "Carb.", precision: 2 },
    { key: "powerDraw", label: "Conso", unit: "kW", precision: 0 },
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
  const [accountId, setAccountId] = useState<string>("");
  const [fleetShips, setFleetShips] = useState<FleetShip[]>([]);
  const [activeShipId, setActiveShipId] = useState<number | null>(null);
  const [loadouts, setLoadouts] = useState<LoadoutWithSlots[]>([]);
  const [activeLoadoutId, setActiveLoadoutId] = useState<number | null>(null);
  const [editSlots, setEditSlots] = useState<SlotEdit[]>([]);
  const [stock, setStock] = useState<StockSlot[]>([]);
  const [modalIndex, setModalIndex] = useState<number | null>(null);
  const [profileNameDraft, setProfileNameDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Mount : compte + flotte ──
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const active = await invoke<string | null>("get_active_account_id");
        const acc = active ?? "";
        const ships = await invoke<FleetShip[]>("get_fleet_ships_for_loadout", { accountId: acc });
        if (cancelled) return;
        setAccountId(acc);
        setFleetShips(ships);
        if (ships.length > 0) {
          await loadShip(ships[0].id, ships, acc);
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

  function applyProfile(loadout: LoadoutWithSlots) {
    setActiveLoadoutId(loadout.id);
    setProfileNameDraft(loadout.profileName);
    setEditSlots(loadout.slots.map(profileSlotToEdit));
  }

  // Nouveau profil = repart de la config STOCK (pré-remplie + hiérarchique), comme V1.
  function applyStock(st: StockSlot[]) {
    setActiveLoadoutId(null);
    setProfileNameDraft("");
    setEditSlots(st.map(stockSlotToEdit).filter((s): s is SlotEdit => s !== null));
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
        profileName: profileNameDraft.trim() || "Nouveau profil",
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

  function pickComponent(comp: ComponentRow) {
    if (modalIndex == null) return;
    setEditSlots((prev) =>
      prev.map((s, i) =>
        i === modalIndex
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
    setModalIndex(null);
  }

  function clearSlot() {
    if (modalIndex == null) return;
    setEditSlots((prev) =>
      prev.map((s, i) =>
        i === modalIndex
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
    setModalIndex(null);
  }

  const modalSlot = modalIndex != null ? editSlots[modalIndex] : null;
  const activeShip = fleetShips.find((s) => s.id === activeShipId) ?? null;
  const activeShipDataId = activeShip?.shipDataId ?? null;

  // Index des enfants par hardpoint parent → rendu hiérarchique (trait de liaison).
  const childIdxByParent = new Map<number, number[]>();
  editSlots.forEach((s, idx) => {
    if (s.parentId != null) {
      const arr = childIdxByParent.get(s.parentId) ?? [];
      arr.push(idx);
      childIdxByParent.set(s.parentId, arr);
    }
  });

  return (
    <div className="p-8">
      <header className="mb-6">
        <p className="text-xs uppercase tracking-[0.18em] text-white/40">Star Citizen</p>
        <h1 className="text-2xl font-bold text-white">LOADOUT PLANNER</h1>
      </header>

      {loading ? (
        <div className="flex items-center gap-2 text-white/50">
          <Loader2 className="h-4 w-4 animate-spin" />
          Chargement…
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
              {/* Sélecteur ship */}
              <select
                value={activeShipId ?? ""}
                onChange={(e) => void loadShip(Number(e.target.value))}
                className="mb-4 w-full max-w-md rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white focus:border-white/20 focus:outline-none"
              >
                {fleetShips.length === 0 && (
                  <option value="" className="bg-[#14141c]">
                    Aucun vaisseau
                  </option>
                )}
                {fleetShips.map((s) => (
                  <option key={s.id} value={s.id} className="bg-[#14141c]">
                    {s.name} — {s.manufacturer}
                  </option>
                ))}
              </select>

              {activeShipId != null && (
                <>
                  {/* Profils */}
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
                            title="Supprimer"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={newProfile}
                        className="flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-white/70 hover:bg-white/10"
                      >
                        <Plus className="h-3.5 w-3.5" /> Nouveau
                      </button>
                    </div>

                    <div className="flex gap-2">
                      <input
                        value={profileNameDraft}
                        onChange={(e) => setProfileNameDraft(e.target.value)}
                        placeholder="Nom du profil"
                        className="flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:border-white/20 focus:outline-none"
                      />
                      <button
                        onClick={() => void save()}
                        disabled={saving}
                        className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                      >
                        {saving ? "…" : "Sauvegarder"}
                      </button>
                    </div>
                  </div>

                  {/* Bandeau image top-down du vaisseau */}
                  <ShipBanner ship={activeShip} />

                  {/* Sections de slots */}
                  {editSlots.length === 0 ? (
                    <p className="text-sm text-white/40">
                      Aucun hardpoint pour ce vaisseau (ShipData non synchronisé).
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 gap-x-6 gap-y-4 lg:grid-cols-2">
                      {SECTIONS.map((section) => {
                        const rootEntries = editSlots
                          .map((s, idx) => ({ s, idx }))
                          .filter(({ s }) => section.types.includes(s.slotType) && (s.depth ?? 0) === 0);
                        if (rootEntries.length === 0) return null;
                        const groups = groupRoots(rootEntries, editSlots, section.disableGrouping);
                        return (
                          <div key={section.title} className={section.fullWidth ? "lg:col-span-2" : ""}>
                            <CategorySection
                              title={section.title}
                              icon={section.icon}
                              count={rootEntries.length}
                              variant={section.variant}
                              collapsible={section.collapsible}
                            >
                              {groups.map((g) => (
                                <SlotTree
                                  key={g.idx}
                                  idx={g.idx}
                                  variant={section.variant}
                                  editSlots={editSlots}
                                  childIdxByParent={childIdxByParent}
                                  selectedIdx={modalIndex}
                                  onSelect={setModalIndex}
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
              <PerformanceSummary slots={editSlots} ship={activeShip} />
            </div>
          </div>
        </>
      )}

      {modalSlot && (
        <ComponentPickerModal
          slot={modalSlot}
          shipDataId={activeShipDataId}
          onPick={pickComponent}
          onClear={clearSlot}
          onClose={() => setModalIndex(null)}
        />
      )}
    </div>
  );
}

/* ── Sous-composants ── */

// Bandeau image top-down du vaisseau (réplique ShipBanner.tsx V1, ratio ~2.5:1).
function ShipBanner({ ship }: { ship: FleetShip | null }) {
  const top = ship?.imageTopDownUrl ?? null;
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
            {isEmpty ? "VIDE" : `${slot.componentName}${countBadge}`}
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
function getSignatureLevel(crossSection: number | null): string {
  if (crossSection == null) return "—";
  if (crossSection < 20000) return "MINIMAL";
  if (crossSection < 80000) return "FAIBLE";
  if (crossSection < 300000) return "MOYENNE";
  return "ÉLEVÉE";
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

function PerformanceSummary({ slots, ship }: { slots: SlotEdit[]; ship: FleetShip | null }) {
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

  const sigLevel = getSignatureLevel(ship?.crossSection ?? null);

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
        Performance
      </h2>
      <div className="space-y-5">
        <StatSection
          label="Offensive"
          mainValue={dpsDisplay}
          mainColor="#60a5fa"
          rows={[
            {
              label: "Alpha damage",
              value: stats.totalAlphaDamage > 0 ? fmtStat(stats.totalAlphaDamage) : "—",
            },
            { label: "Burst DPS (5s)", value: "—" },
          ]}
          progressPercent={dpsProgress}
        />

        <StatSection
          label="Défensif"
          mainValue={shieldDisplay}
          mainColor="#fbbf24"
          rows={[
            {
              label: "Régén bouclier",
              value: stats.shieldRegenRate > 0 ? `${fmtStat(stats.shieldRegenRate)} HP/s` : "—",
              color: "#fbbf24",
            },
            {
              label: "Délai bouclier (dmg)",
              value: stats.shieldDelayDmg != null ? `${stats.shieldDelayDmg.toFixed(1)} s` : "—",
              color: "#fbbf24",
            },
          ]}
          progressPercent={shieldProgress}
        />

        <StatSection
          label="Signature radar"
          mainValue={sigLevel}
          mainColor="rgba(255,255,255,0.8)"
          rows={[
            {
              label: "Signature EM",
              value: ship?.emSignature != null ? fmtStat(ship.emSignature) : "—",
              color: "#93ccff",
            },
            {
              label: "Signature IR",
              value: ship?.irSignature != null ? fmtStat(ship.irSignature) : "—",
              color: "#f87171",
            },
            {
              label: "Section efficace",
              value: ship?.crossSection != null ? fmtStat(ship.crossSection) : "—",
            },
          ]}
        />

        <StatSection
          label="Énergie"
          mainValue={powerDisplay}
          mainColor={powerSectionColor}
          rows={[
            {
              label: "Sortie",
              value: stats.totalPowerOutput > 0 ? `${fmtStat(stats.totalPowerOutput)} kW` : "—",
            },
            { label: "Marge", value: powerMarginStr, color: powerMarginColor },
          ]}
          progressPercent={powerProgress}
        />
      </div>
    </div>
  );
}

function ComponentPickerModal({
  slot,
  shipDataId,
  onPick,
  onClear,
  onClose,
}: {
  slot: SlotEdit;
  shipDataId: number | null;
  onPick: (c: ComponentRow) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const [components, setComponents] = useState<ComponentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  // Tri d'affichage (pur front). null = état GROUPÉ par sous-type (défaut à l'ouverture).
  const [sortKey, setSortKey] = useState<keyof ComponentRow | null>(null);
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // Repart en état groupé (sans tri) à chaque changement de slot / réouverture.
    setSortKey(null);
    setSortDir("desc");
    // Matching fin (Lot 2) : résolu côté Rust à partir du (shipDataId, portName) du slot —
    // type, taille bornée, subType et famille de required_tags (réplique getCompatible V1).
    const query: Promise<ComponentRow[]> =
      shipDataId != null && slot.portName
        ? invoke<ComponentRow[]>("get_components_for_slot", {
            shipDataId,
            portName: slot.portName,
          })
        : Promise.resolve([]);
    query
      .then((data) => {
        if (!cancelled) setComponents(data);
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
  }, [shipDataId, slot.portName]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return components;
    return components.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.manufacturer?.toLowerCase().includes(q) ?? false),
    );
  }, [components, search]);

  const spec = SLOT_TYPE_SPECS[slot.slotType] ?? [];
  const portLabel = slot.portName ? humanizePortName(slot.portName) : slot.slotType.replace(/_/g, " ");

  // Groupe les armes par type (LASER/BALLISTIC…) ; liste plate pour les autres types.
  const grouped: Array<{ group: string | null; items: ComponentRow[] }> =
    slot.slotType === "WEAPON"
      ? (() => {
          const map = new Map<string, ComponentRow[]>();
          for (const c of filtered) {
            const key = deriveWeaponType(c.className) ?? "AUTRE";
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
            Configuration du point d'emport
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
              {filtered.length} composant{filtered.length !== 1 ? "s" : ""}
            </span>
            {sortKey != null && (
              <button
                onClick={() => setSortKey(null)}
                className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-white/60 transition-colors hover:bg-white/10"
                title="Revenir au regroupement par sous-type"
              >
                ↺ Regrouper
              </button>
            )}
            <button onClick={onClose} className="ml-auto rounded-lg p-1 text-white/50 hover:bg-white/10">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Recherche */}
        <div className="shrink-0 px-6 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher un composant…"
              className="w-full rounded-full border border-white/10 bg-white/5 py-2 pl-9 pr-4 text-sm text-white placeholder:text-white/40 focus:border-white/20 focus:outline-none"
            />
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
              Composant
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {sortHeader("Taille", "size", "left")}
              {sortHeader("Grade", "grade", "left")}
            </div>
            <div className="flex shrink-0 items-center gap-5">
              {spec.map((s) => (
                <span key={s.key}>{sortHeader(s.label, s.key, "right")}</span>
              ))}
            </div>
          </div>
        )}

        {/* Corps */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-[11px] uppercase tracking-widest text-white/40">
              <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
            </div>
          ) : error ? (
            <p className="px-6 py-4 text-sm text-red-300">{error}</p>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-white/40">
              <PackageOpen className="h-9 w-9 opacity-25" />
              <span className="text-[11px] uppercase tracking-widest">Aucun composant compatible</span>
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
            Vider le slot
          </button>
        </div>
      </div>
    </div>
  );
}

function PickerRow({
  comp,
  specs,
  current,
  onSelect,
}: {
  comp: ComponentRow;
  specs: StatSpec[];
  current: string | null;
  onSelect: () => void;
}) {
  const isActive = comp.className != null && comp.className === current;
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full items-center gap-4 px-6 py-3 text-left transition-colors hover:bg-white/[0.04]"
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
      <div className="flex shrink-0 items-center gap-5">
        {specs.map((s) => (
          <div key={s.key} className="text-right" style={{ minWidth: "48px" }}>
            <div className="font-mono text-[12px] text-white">{formatStat(getStat(comp, s.key), s)}</div>
            <div className="text-[9px] font-semibold uppercase tracking-wider text-white/40">
              {s.label}
            </div>
          </div>
        ))}
      </div>
    </button>
  );
}
