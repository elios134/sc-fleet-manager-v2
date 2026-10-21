import { useCallback, useEffect, useMemo, useState } from "react";
import { useBlocker, useLocation, useSearchParams } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { refreshStarjumpManifest } from "../../../lib/starjump";
import { type FleetShip, type SlotEdit, type LoadoutWithSlots, type StockSlot, type ComponentRow, type CatalogShip, type ShipMeta, type AcqDetailData } from "../types";
import { initialShip, provenanceOf } from "../cost";
import { stockSlotToEdit, profileSlotToEdit } from "../helpers";

// État et logique de la page Loadout : vaisseau, profils, slots, sauvegarde, garde de navigation.
export function useLoadoutPage() {
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
  // Composant d'origine par port (pour « D'origine ») + détails d'acquisition par classe.
  const [stockByPort, setStockByPort] = useState<Record<string, string | null>>({});
  const [acq, setAcq] = useState<Record<string, AcqDetailData | null>>({});
  const [searchParams, setSearchParams] = useSearchParams();

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
        // ?ship= (autre onglet Vaisseaux), présélection (« Ouvrir le configurateur »), sinon 1er.
        const preselectId = (location.state as { preselectShipId?: number } | null)?.preselectShipId ?? null;
        const pick = initialShip(ships, Number(searchParams.get("ship")) || null, preselectId);
        if (pick?.kind === "owned") await loadShip(pick.id, ships, acc);
        else if (pick?.kind === "catalog") await loadCatalogShip(pick.shipDataId);
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
      setStockByPort(Object.fromEntries(st.map((x) => [x.portName, x.componentClassName])));
      if (ship?.shipDataId != null) setSearchParams((p) => { p.set("ship", String(ship.shipDataId)); return p; }, { replace: true });
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
      setStockByPort(Object.fromEntries(st.map((x) => [x.portName, x.componentClassName])));
      setSearchParams((p) => { p.set("ship", String(shipDataId)); return p; }, { replace: true });
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
  // Détails d'acquisition chargés une fois par classe équipée.
  useEffect(() => {
    const todo = [...new Map(editSlots.filter((x) => x.componentClassName && !(x.componentClassName in acq)).map((x) => [x.componentClassName!, x.componentName])).entries()];
    if (todo.length === 0) return;
    let cancelled = false;
    void Promise.all(
      todo.map(([className, name]) =>
        invoke<AcqDetailData>("get_acquisition_detail", { className, name }).then((d) => [className, d] as const).catch(() => [className, null] as const),
      ),
    ).then((res) => { if (!cancelled) setAcq((prev) => ({ ...prev, ...Object.fromEntries(res) })); });
    return () => { cancelled = true; };
  }, [editSlots, acq]);
  const provenance = useCallback(
    (slot: SlotEdit) => (slot.componentClassName && slot.componentClassName in acq ? provenanceOf(slot, stockByPort[slot.portName] ?? null, acq[slot.componentClassName]) : null),
    [acq, stockByPort],
  );
  const costItems = useMemo(
    () => editSlots.filter((x) => x.componentName && x.componentClassName && x.componentClassName in acq).map((x) => ({ name: x.componentName!, prov: provenance(x)! })),
    [editSlots, acq, provenance],
  );

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

  return {
    t,
    location,
    dirty,
    setDirty,
    accountId,
    setAccountId,
    fleetShips,
    setFleetShips,
    catalogShips,
    setCatalogShips,
    activeShipId,
    setActiveShipId,
    planner,
    setPlanner,
    previewShipDataId,
    setPreviewShipDataId,
    editSlots,
    setEditSlots,
    modalMembers,
    setModalMembers,
    profileNameDraft,
    setProfileNameDraft,
    saving,
    setSaving,
    loading,
    setLoading,
    error,
    setError,
    stockByPort,
    setStockByPort,
    acq,
    setAcq,
    searchParams,
    setSearchParams,
    loadShip,
    loadCatalogShip,
    applyProfile,
    applyStock,
    save,
    openPicker,
    pickComponent,
    clearSlot,
    modalIndex,
    modalSlot,
    isPreview,
    hasSelection,
    activeFleetShip,
    isRented,
    activeCatalogShip,
    provenance,
    costItems,
    activeShipDataId,
    activeShipMeta,
    blocker,
    childIdxByParent,
    presentHpIds,
    isRootSlot,
  };
}
