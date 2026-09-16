import { useSyncExternalStore } from "react";
import type { CargoReferenceSyncReport, UexSyncReport } from "../types";
import { WikiSyncResult, ComponentSyncResult, CatalogSyncReport, VehicleSyncReport, MissionSyncResult, BlueprintSyncResult, StarmapSyncResult, SyncProgress, GroupState, SyncSourceKey, IDLE_GROUP } from "../syncTypes";

type DonneesState = {
  syncing: boolean; result: WikiSyncResult | null; error: string | null;
  syncingComp: boolean; compResult: ComponentSyncResult | null;
  syncingMissions: boolean; missionResult: MissionSyncResult | null;
  syncingBlueprints: boolean; blueprintResult: BlueprintSyncResult | null;
  syncingStarmapWiki: boolean; starmapResult: StarmapSyncResult | null;
  progress: SyncProgress | null;
  syncingCargoPos: boolean; cargoPosResult: CargoReferenceSyncReport | null;
  syncingUex: boolean; uexResult: UexSyncReport | null;
  syncingItemCat: boolean; itemCatResult: CatalogSyncReport | null;
  syncingVehMkt: boolean; vehMktResult: VehicleSyncReport | null;
  wikiGroup: GroupState; cargoGroup: GroupState; uexGroup: GroupState;
  allRunning: boolean; allResult: { failedKeys: string[] } | null;
  advancedOpen: boolean;
  // Horodatage ISO de la dernière sync par source (freshness). null = jamais.
  lastSync: Record<SyncSourceKey, string | null>;
};
let donneesState: DonneesState = {
  syncing: false, result: null, error: null,
  syncingComp: false, compResult: null,
  syncingMissions: false, missionResult: null,
  syncingBlueprints: false, blueprintResult: null,
  syncingStarmapWiki: false, starmapResult: null,
  progress: null,
  syncingCargoPos: false, cargoPosResult: null,
  syncingUex: false, uexResult: null,
  syncingItemCat: false, itemCatResult: null,
  syncingVehMkt: false, vehMktResult: null,
  wikiGroup: IDLE_GROUP, cargoGroup: IDLE_GROUP, uexGroup: IDLE_GROUP,
  allRunning: false, allResult: null,
  advancedOpen: false,
  lastSync: { wiki: null, cargo: null, uex: null },
};
const donneesSubs = new Set<() => void>();
function donneesSet<K extends keyof DonneesState>(
  key: K,
  val: DonneesState[K] | ((p: DonneesState[K]) => DonneesState[K]),
) {
  const next = typeof val === "function" ? (val as (p: DonneesState[K]) => DonneesState[K])(donneesState[key]) : val;
  donneesState = { ...donneesState, [key]: next };
  donneesSubs.forEach((s) => s());
}

// Hook : renvoie EXACTEMENT les mêmes noms (value + setter) qu'avant → handlers/JSX inchangés.
function useDonneesSyncState() {
  const s = useSyncExternalStore(
    (cb) => {
      donneesSubs.add(cb);
      return () => donneesSubs.delete(cb);
    },
    () => donneesState,
  );
  return {
    syncing: s.syncing, setSyncing: (v: boolean | ((p: boolean) => boolean)) => donneesSet("syncing", v),
    result: s.result, setResult: (v: WikiSyncResult | null) => donneesSet("result", v),
    error: s.error, setError: (v: string | null) => donneesSet("error", v),
    syncingComp: s.syncingComp, setSyncingComp: (v: boolean) => donneesSet("syncingComp", v),
    compResult: s.compResult, setCompResult: (v: ComponentSyncResult | null) => donneesSet("compResult", v),
    syncingMissions: s.syncingMissions, setSyncingMissions: (v: boolean) => donneesSet("syncingMissions", v),
    missionResult: s.missionResult, setMissionResult: (v: MissionSyncResult | null) => donneesSet("missionResult", v),
    syncingBlueprints: s.syncingBlueprints, setSyncingBlueprints: (v: boolean) => donneesSet("syncingBlueprints", v),
    blueprintResult: s.blueprintResult, setBlueprintResult: (v: BlueprintSyncResult | null) => donneesSet("blueprintResult", v),
    syncingStarmapWiki: s.syncingStarmapWiki, setSyncingStarmapWiki: (v: boolean) => donneesSet("syncingStarmapWiki", v),
    starmapResult: s.starmapResult, setStarmapResult: (v: StarmapSyncResult | null) => donneesSet("starmapResult", v),
    progress: s.progress, setProgress: (v: SyncProgress | null) => donneesSet("progress", v),
    syncingCargoPos: s.syncingCargoPos, setSyncingCargoPos: (v: boolean) => donneesSet("syncingCargoPos", v),
    cargoPosResult: s.cargoPosResult, setCargoPosResult: (v: CargoReferenceSyncReport | null) => donneesSet("cargoPosResult", v),
    syncingUex: s.syncingUex, setSyncingUex: (v: boolean) => donneesSet("syncingUex", v),
    uexResult: s.uexResult, setUexResult: (v: UexSyncReport | null) => donneesSet("uexResult", v),
    syncingItemCat: s.syncingItemCat, setSyncingItemCat: (v: boolean) => donneesSet("syncingItemCat", v),
    itemCatResult: s.itemCatResult, setItemCatResult: (v: CatalogSyncReport | null) => donneesSet("itemCatResult", v),
    syncingVehMkt: s.syncingVehMkt, setSyncingVehMkt: (v: boolean) => donneesSet("syncingVehMkt", v),
    vehMktResult: s.vehMktResult, setVehMktResult: (v: VehicleSyncReport | null) => donneesSet("vehMktResult", v),
    wikiGroup: s.wikiGroup, setWikiGroup: (v: GroupState) => donneesSet("wikiGroup", v),
    cargoGroup: s.cargoGroup, setCargoGroup: (v: GroupState) => donneesSet("cargoGroup", v),
    uexGroup: s.uexGroup, setUexGroup: (v: GroupState) => donneesSet("uexGroup", v),
    allRunning: s.allRunning, setAllRunning: (v: boolean) => donneesSet("allRunning", v),
    allResult: s.allResult, setAllResult: (v: { failedKeys: string[] } | null) => donneesSet("allResult", v),
    advancedOpen: s.advancedOpen, setAdvancedOpen: (v: boolean | ((p: boolean) => boolean)) => donneesSet("advancedOpen", v),
    lastSync: s.lastSync,
    setLastSyncAt: (key: SyncSourceKey, iso: string | null) =>
      donneesSet("lastSync", (p) => ({ ...p, [key]: iso })),
    setLastSyncAll: (v: Record<SyncSourceKey, string | null>) => donneesSet("lastSync", v),
  };
}

export { useDonneesSyncState };
