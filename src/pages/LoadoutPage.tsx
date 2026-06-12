import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Loader2, Plus, Search, X } from "lucide-react";

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
};

const SECTIONS: Array<{ title: string; types: string[] }> = [
  { title: "Armes", types: ["WEAPON"] },
  { title: "Missiles", types: ["MISSILE"] },
  { title: "Systèmes", types: ["SHIELD", "POWER_PLANT"] },
  { title: "Propulsion", types: ["QUANTUM_DRIVE", "COOLER"] },
];

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
  const activeShipDataId = fleetShips.find((s) => s.id === activeShipId)?.shipDataId ?? null;

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

                  {/* Sections de slots */}
                  {editSlots.length === 0 ? (
                    <p className="text-sm text-white/40">
                      Aucun hardpoint pour ce vaisseau (ShipData non synchronisé).
                    </p>
                  ) : (
                    <div className="flex flex-col gap-4">
                      {SECTIONS.map((section) => {
                        const slots = editSlots
                          .map((s, idx) => ({ s, idx }))
                          .filter(({ s }) => section.types.includes(s.slotType));
                        if (slots.length === 0) return null;
                        return (
                          <CategorySection key={section.title} title={section.title} count={slots.length}>
                            {slots.map(({ s, idx }) => (
                              <div
                                key={idx}
                                style={{ paddingLeft: (s.depth ?? 0) * 20 }}
                              >
                                <SlotRow slot={s} onClick={() => setModalIndex(idx)} />
                              </div>
                            ))}
                          </CategorySection>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Colonne droite ~35% */}
            <div className="lg:w-[35%]">
              <PerformanceSummary
                slots={editSlots}
                ship={fleetShips.find((s) => s.id === activeShipId) ?? null}
              />
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

function CategorySection({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <button
        onClick={() => setOpen((v) => !v)}
        className="mb-2 flex w-full items-center justify-between text-sm font-semibold uppercase tracking-wider text-white/70"
      >
        <span>
          {title} <span className="text-white/30">({count})</span>
        </span>
        <span className="text-white/40">{open ? "−" : "+"}</span>
      </button>
      {open && <div className="flex flex-col gap-2">{children}</div>}
    </div>
  );
}

function SlotRow({ slot, onClick }: { slot: SlotEdit; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2 text-left transition-colors hover:bg-white/10"
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-white">{slot.displayName}</p>
        <p className="text-xs text-white/40">
          {slot.slotType} · S{slot.slotSize}
        </p>
      </div>
      <span
        className={[
          "shrink-0 truncate text-sm",
          slot.componentName ? "text-[var(--accent)]" : "text-white/30",
        ].join(" ")}
      >
        {slot.componentName ?? "Vide"}
      </span>
    </button>
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

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative z-10 flex max-h-[80vh] w-full max-w-lg flex-col rounded-2xl border p-5 backdrop-blur-2xl"
        style={{ background: "rgba(20,20,28,0.92)", borderColor: "var(--card-border)" }}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-white">{slot.displayName}</h2>
            <p className="text-xs text-white/40">
              {slot.slotType} · taille ≤ {slot.slotSize}
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-white/50 hover:bg-white/10">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="relative mb-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un composant…"
            className="w-full rounded-full border border-white/10 bg-white/5 py-2 pl-9 pr-4 text-sm text-white placeholder:text-white/40 focus:border-white/20 focus:outline-none"
          />
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center gap-2 text-white/50">
              <Loader2 className="h-4 w-4 animate-spin" />
              Chargement…
            </div>
          ) : error ? (
            <p className="text-sm text-red-300">{error}</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-white/40">Aucun composant compatible.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {filtered.map((c) => (
                <li key={c.className}>
                  <button
                    onClick={() => onPick(c)}
                    className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2 text-left transition-colors hover:bg-white/10"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-white">{c.name}</p>
                      <p className="truncate text-xs text-white/40">
                        {c.manufacturer ?? "—"} · S{c.size}
                        {c.grade ? ` · ${c.grade}` : ""}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-white/50">
                      {c.dps != null ? `${Math.round(c.dps)} dps` : c.shieldHp != null ? `${Math.round(c.shieldHp)} HP` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-3 border-t border-white/10 pt-3">
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
