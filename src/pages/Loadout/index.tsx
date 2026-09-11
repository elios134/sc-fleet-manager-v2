import { useEffect, useState } from "react";
import { useBlocker, useLocation } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import Dropdown from "../../components/ui/Dropdown";
import { Check, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { refreshStarjumpManifest } from "../../lib/starjump";
import MiningPlanner from "../../components/loadout/MiningPlanner";
import SalvagePlanner from "../../components/loadout/SalvagePlanner";
import { type FleetShip, type SlotEdit, type LoadoutWithSlots, type StockSlot, type ComponentRow, type CatalogShip, type ShipMeta } from "./types";
import { SECTIONS, stockSlotToEdit, profileSlotToEdit, groupRoots } from "./helpers";
import { ShipBanner } from "./components/ShipBanner";
import { CategorySection } from "./components/CategorySection";
import { SlotTree, LoadoutNode } from "./components/SlotTree";
import { PerformanceSummary } from "./components/PerformanceSummary";
import { ComponentPickerModal } from "./components/ComponentPickerModal";

export default function LoadoutPage() {
  const { t } = useTranslation();
  const location = useLocation();
  // Modifs non sauvegardées (pour confirmer avant de quitter la page).
  const [dirty, setDirty] = useState(false);
  const [accountId, setAccountId] = useState<string>("");
  const [fleetShips, setFleetShips] = useState<FleetShip[]>([]);
  const [catalogShips, setCatalogShips] = useState<CatalogShip[]>([]);
  const [activeShipId, setActiveShipId] = useState<number | null>(null);
  // Sous-onglet du planificateur : composants (base) / minage / salvage.
  const [planner, setPlanner] = useState<"components" | "mining" | "salvage">("components");
  // Preview mode : vaisseau du catalogue (non possédé) sélectionné → ShipData.id.
  const [previewShipDataId, setPreviewShipDataId] = useState<number | null>(null);
  const [editSlots, setEditSlots] = useState<SlotEdit[]>([]);
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
    try {
      const st = await invoke<StockSlot[]>("get_stock_for_ship", { shipDataId });
      applyStock(st);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function applyProfile(loadout: LoadoutWithSlots) {
    setProfileNameDraft(loadout.profileName);
    setEditSlots(loadout.slots.map(profileSlotToEdit));
    setDirty(false);
  }

  // Nouveau profil = repart de la config STOCK (pré-remplie + hiérarchique), comme V1.
  function applyStock(st: StockSlot[]) {
    setProfileNameDraft("");
    setEditSlots(st.map(stockSlotToEdit).filter((s): s is SlotEdit => s !== null));
    setDirty(false);
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

      {/* Sous-onglets : Composants (base) / Minage / Salvage */}
      <div className="mb-6 inline-flex rounded-xl border border-white/10 bg-white/[0.02] p-1">
        {([
          ["components", t("loadout.tab.components")],
          ["mining", t("loadout.tab.mining")],
          ["salvage", t("loadout.tab.salvage")],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setPlanner(key)}
            className={[
              "rounded-lg px-4 py-1.5 text-sm font-medium transition-colors",
              planner === key ? "bg-[var(--accent)]/20 text-[var(--accent)]" : "text-white/50 hover:text-white/80",
            ].join(" ")}
          >
            {label}
          </button>
        ))}
      </div>

      {planner === "mining" ? (
        <MiningPlanner />
      ) : planner === "salvage" ? (
        <SalvagePlanner />
      ) : loading ? (
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
                  {/* Sauvegarde auto : bouton visible uniquement quand un changement est détecté ;
                      sinon, simple indicateur « Enregistré ». Plus de gestion manuelle de profils. */}
                  {!isPreview && !isRented && (
                    <div className="mb-5 flex items-center justify-end">
                      {dirty ? (
                        <button
                          onClick={() => void save()}
                          disabled={saving}
                          className="inline-flex items-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                        >
                          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                          {saving ? t("loadout.savingShort") : t("loadout.saveBtn")}
                        </button>
                      ) : (
                        <span className="inline-flex items-center gap-2 text-sm text-white/40">
                          <Check className="h-4 w-4 text-emerald-400" />
                          {t("loadout.savedLabel")}
                        </span>
                      )}
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
