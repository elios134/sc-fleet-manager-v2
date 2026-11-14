// Logique des synchronisations de la page Paramètres › Données (déplacée telle quelle de
// l'ancien DonneesTab) : groupes de syncs, « Tout synchroniser », syncs individuelles, dates
// de dernière synchro. L'état vit dans le store de useDonneesSync (survit au changement de section).
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { CargoReferenceSyncReport, UexSyncReport } from "../types";
import { useDonneesSyncState } from "./useDonneesSync";
import { LAST_SYNC_META_PREFIX } from "../syncTypes";
import { runSourceGroup } from "../lib/syncGroups";
import type { WikiSyncResult, ComponentSyncResult, CatalogSyncReport, ItemImageSyncReport, VehicleSyncReport, MissionSyncResult, BlueprintSyncResult, StarmapSyncResult, SyncProgress, SyncSourceKey } from "../syncTypes";

export function useDataSync() {
  const state = useDonneesSyncState();
  const {
    syncing, setSyncing, setResult, setError,
    syncingComp, setSyncingComp, setCompResult,
    syncingMissions, setSyncingMissions, setMissionResult,
    syncingBlueprints, setSyncingBlueprints, setBlueprintResult,
    syncingStarmapWiki, setSyncingStarmapWiki, setStarmapResult,
    setProgress,
    syncingCargoPos, setSyncingCargoPos, setCargoPosResult,
    syncingUex, setSyncingUex, setUexResult,
    syncingItemCat, setSyncingItemCat, setItemCatResult,
    syncingVehMkt, setSyncingVehMkt, setVehMktResult,
    wikiGroup, cargoGroup, uexGroup,
    allRunning, setAllRunning, setAllResult,
    setLastSyncAll,
  } = state;

  // Charge les horodatages de dernière sync (freshness) au montage — persistés en AppMeta.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const keys: SyncSourceKey[] = ["wiki", "cargo", "uex"];
      const entries = await Promise.all(
        keys.map(async (k) => {
          try {
            const v = await invoke<string | null>("get_app_meta", {
              key: LAST_SYNC_META_PREFIX + k,
            });
            return [k, v ?? null] as const;
          } catch {
            return [k, null] as const;
          }
        }),
      );
      if (cancelled) return;
      const next: Record<SyncSourceKey, string | null> = { wiki: null, cargo: null, uex: null };
      for (const [k, v] of entries) next[k] = v;
      setLastSyncAll(next);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lecture unique au montage
  }, []);

  // « Tout synchroniser » : ordre global SÛR Wiki → Cargo & Carte → UEX (UEX lit
  // WikiStarmapLocation que Cargo & Carte remplit). CCU exclu (login interactif).
  async function runAllGroups() {
    setError(null);
    setAllResult(null);
    setAllRunning(true);
    try {
      const failed: string[] = [];
      for (const key of ["wiki", "cargo", "uex"] as const) failed.push(...(await runSourceGroup(key)));
      setAllResult({ failedKeys: failed });
    } finally {
      setAllRunning(false);
    }
  }

  // Synchronise UNE source depuis sa ligne du tableau de fraîcheur (bouton « Synchroniser »).
  async function runSource(key: SyncSourceKey) {
    await runSourceGroup(key);
  }

  // Helper générique de synchro : gère busy / erreur / reset + (option) la barre de
  // progression Wiki. Chaque bouton de sync s'y ramène (supprime ~10 fonctions identiques).
  async function runSync<T>(
    cmd: string,
    setBusy: (b: boolean) => void,
    setResult: (r: T | null) => void,
    withProgress = false,
  ) {
    setBusy(true);
    setError(null);
    setResult(null);
    const un = withProgress ? await listen<SyncProgress>("wiki:sync-progress", (e) => setProgress(e.payload)) : null;
    if (withProgress) setProgress(null);
    try {
      setResult(await invoke<T>(cmd));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      un?.();
      if (withProgress) setProgress(null);
      setBusy(false);
    }
  }

  const syncItemCatalog = () => runSync<CatalogSyncReport>("sync_item_catalog", setSyncingItemCat, setItemCatResult);
  // Images d'objets (couverture complète) — état local (indépendant, lecture seule côté jeu).
  const [syncingItemImg, setSyncingItemImg] = useState(false);
  const [itemImgResult, setItemImgResult] = useState<ItemImageSyncReport | null>(null);
  const syncItemImages = () => runSync<ItemImageSyncReport>("sync_item_images", setSyncingItemImg, setItemImgResult);
  const syncVehicleMarketplace = () => runSync<VehicleSyncReport>("sync_vehicle_marketplace", setSyncingVehMkt, setVehMktResult);
  const syncCargoPositions = () => runSync<CargoReferenceSyncReport>("sync_cargo_reference", setSyncingCargoPos, setCargoPosResult);
  const syncUex = () => runSync<UexSyncReport>("sync_uex_prices", setSyncingUex, setUexResult);

  const syncWiki = () => runSync<WikiSyncResult>("sync_ship_data", setSyncing, setResult, true);
  const syncComponents = () => runSync<ComponentSyncResult>("sync_components", setSyncingComp, setCompResult, true);
  const syncMissions = () => runSync<MissionSyncResult>("sync_missions", setSyncingMissions, setMissionResult, true);
  const syncBlueprints = () => runSync<BlueprintSyncResult>("sync_blueprints", setSyncingBlueprints, setBlueprintResult, true);

  // Carte galactique : depuis les données Wiki en base (sans réseau) OU depuis l'API RSI
  // Starmap (réseau côté Rust). Mêmes états d'affichage.
  const syncStarmapWiki = () => runSync<StarmapSyncResult>("sync_starmap", setSyncingStarmapWiki, setStarmapResult);
  const syncStarmapRsi = () => runSync<StarmapSyncResult>("sync_starmap_from_rsi", setSyncingStarmapWiki, setStarmapResult);

  // Occupation : aucune sync ne doit en chevaucher une autre (conserve + renforce les
  // mutex existants). Tous les boutons (groupés, individuels, CCU, « Tout ») sont
  // désactivés dès qu'une sync tourne, où qu'elle soit.
  const individualBusy =
    syncing ||
    syncingComp ||
    syncingMissions ||
    syncingBlueprints ||
    syncingStarmapWiki ||
    syncingCargoPos ||
    syncingUex ||
    syncingItemCat ||
    syncingVehMkt;
  const groupBusy = wikiGroup.running || cargoGroup.running || uexGroup.running || allRunning;
  const anyBusy = individualBusy || groupBusy;

  return {
    ...state,
    syncingItemImg, itemImgResult,
    anyBusy, runAllGroups, runSource,
    syncWiki, syncComponents, syncMissions, syncBlueprints, syncStarmapWiki, syncStarmapRsi,
    syncCargoPositions, syncUex, syncItemCatalog, syncVehicleMarketplace, syncItemImages,
  };
}

export type DataSync = ReturnType<typeof useDataSync>;
