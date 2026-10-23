// Mode « Loadouts » du comparateur : 3 colonnes (vaisseau + profil, stock inclus), la 1re sert
// de référence. Les profils viennent des vaisseaux de la flotte ; le stock de tout le catalogue.
import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { usePersistentState } from "../../../lib/uiPersist";
import { mapHardpointType } from "../../../lib/loadoutSlots";
import type { ShipDataRow } from "../compare";
import { loadoutStats, type EquipSlot, type LoadoutStats } from "../lib/loadouts";

export type Col = { shipDataId: number | null; profile: number | "stock" };
type FleetShip = { id: number; shipDataId: number | null };
type Profile = { id: number; profileName: string; slots: EquipSlot[] };
type StockSlot = EquipSlot & { slotType: string };

const EMPTY_COLS: Col[] = [0, 1, 2].map(() => ({ shipDataId: null, profile: "stock" }));

export function useLoadoutCompare(ships: ShipDataRow[]) {
  const [cols, setCols] = usePersistentState<Col[]>("comparator.loadouts", EMPTY_COLS);
  const [fleet, setFleet] = useState<FleetShip[]>([]);
  const [accountId, setAccountId] = useState("");
  const [profiles, setProfiles] = useState<Record<number, Profile[]>>({});
  const [stock, setStock] = useState<Record<number, EquipSlot[]>>({});

  useEffect(() => {
    void (async () => {
      const acc = (await invoke<string | null>("get_active_account_id").catch(() => null)) ?? "";
      setAccountId(acc);
      setFleet(await invoke<FleetShip[]>("get_fleet_ships_for_loadout", { accountId: acc }).catch(() => []));
    })();
  }, []);

  const fleetIdOf = (shipDataId: number | null) => fleet.find((f) => f.shipDataId === shipDataId)?.id ?? null;
  const wanted = cols.map((c) => c.shipDataId).filter((id): id is number => id != null);
  const wantedKey = wanted.join("|");
  // Stock et profils de chaque vaisseau choisi, chargés une fois.
  useEffect(() => {
    for (const id of new Set(wanted)) {
      if (!stock[id]) {
        invoke<StockSlot[]>("get_stock_for_ship", { shipDataId: id })
          .then((st) => setStock((m) => ({ ...m, [id]: st.map((s) => ({ ...s, slotType: mapHardpointType(s.slotType) ?? s.slotType })) })))
          .catch(() => setStock((m) => ({ ...m, [id]: [] })));
      }
      const fid = fleet.find((f) => f.shipDataId === id)?.id;
      if (fid != null && !profiles[fid]) {
        invoke<Profile[]>("get_loadouts_by_ship", { shipId: fid, accountId })
          .then((lo) => setProfiles((m) => ({ ...m, [fid]: lo })))
          .catch(() => setProfiles((m) => ({ ...m, [fid]: [] })));
      }
    }
    // stock / profiles : caches remplis par cet effet, pas des déclencheurs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantedKey, fleet, accountId]);

  const columns = useMemo(
    () =>
      cols.map((c) => {
        const ship = ships.find((s) => s.id === c.shipDataId) ?? null;
        const fid = fleet.find((f) => f.shipDataId === c.shipDataId)?.id ?? null;
        const own = fid != null ? profiles[fid] ?? [] : [];
        const profile = c.profile === "stock" ? null : own.find((p) => p.id === c.profile) ?? null;
        const slots = profile ? profile.slots : c.shipDataId != null ? stock[c.shipDataId] ?? null : null;
        const stats: LoadoutStats | null = ship && slots ? loadoutStats(slots, ship.crossSection) : null;
        return { col: c, ship, profiles: own, profileName: profile?.profileName ?? null, slots, stats };
      }),
    [cols, ships, fleet, profiles, stock],
  );

  return {
    columns,
    isOwned: (shipDataId: number) => fleetIdOf(shipDataId) != null,
    setShip: (i: number, shipDataId: number | null) => setCols(cols.map((c, j) => (j === i ? { shipDataId, profile: "stock" } : c))),
    setProfile: (i: number, profile: number | "stock") => setCols(cols.map((c, j) => (j === i ? { ...c, profile } : c))),
  };
}
export type LoadoutCompare = ReturnType<typeof useLoadoutCompare>;
