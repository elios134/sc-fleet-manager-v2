// Logique des synchronisations de la page Paramètres › Données (déplacée telle quelle de
// l'ancien DonneesTab) : groupes de syncs, « Tout synchroniser », syncs individuelles, dates
// de dernière synchro. L'état vit dans le store de useDonneesSync (survit au changement de section).
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { CargoReferenceSyncReport, UexSyncReport } from "../types";
import { useDonneesSyncState } from "./useDonneesSync";
import { IDLE_GROUP, LAST_SYNC_META_PREFIX } from "../syncTypes";
import type { WikiSyncResult, ComponentSyncResult, CatalogSyncReport, ItemImageSyncReport, VehicleSyncReport, MissionSyncResult, BlueprintSyncResult, StarmapSyncResult, SyncProgress, SyncStepDef, GroupState, SyncSourceKey } from "../syncTypes";

const WIKI_STEPS: SyncStepDef[] = [
  { cmd: "sync_ship_data", labelKey: "settings.donnees.syncShipsBtn" },
  { cmd: "sync_components", labelKey: "settings.donnees.syncCompBtn" },
  { cmd: "sync_missions", labelKey: "settings.donnees.syncMissionsBtn" },
  { cmd: "sync_blueprints", labelKey: "settings.donnees.syncBlueprintsBtn" },
];

// Groupe « Cargo & Carte » : ORDRE OBLIGATOIRE. sync_cargo_reference (Lieux) remplit
// WikiStarmapLocation, relu par le repli Wiki de sync_starmap (Carte). Ne jamais inverser.
const CARGO_STEPS: SyncStepDef[] = [
  { cmd: "sync_cargo_reference", labelKey: "settings.donnees.cargoPositionsBtn" },
  { cmd: "sync_starmap", labelKey: "settings.donnees.syncStarmapWikiBtn" },
];

// Groupe « Catalogue UEX » : sync_item_images (SC Wiki) DOIT suivre sync_item_catalog,
// qui fait DELETE FROM Item puis réinsère → lancé avant, les imageUrl seraient écrasées.
const UEX_STEPS: SyncStepDef[] = [
  { cmd: "sync_uex_prices", labelKey: "settings.donnees.uexBtn" },
  { cmd: "sync_item_catalog", labelKey: "settings.donnees.catalogItemsBtn" },
  { cmd: "sync_vehicle_marketplace", labelKey: "settings.donnees.catalogVehiclesBtn" },
  { cmd: "sync_item_images", labelKey: "settings.donnees.catalogImagesBtn" },
];

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
    wikiGroup, setWikiGroup, cargoGroup, setCargoGroup, uexGroup, setUexGroup,
    allRunning, setAllRunning, setAllResult,
    setLastSyncAt, setLastSyncAll,
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
  }, []);

  // Enregistre l'horodatage de dernière sync d'une source (store + AppMeta persistant).
  async function markSynced(key: SyncSourceKey) {
    const iso = new Date().toISOString();
    setLastSyncAt(key, iso);
    try {
      await invoke("set_app_meta", { key: LAST_SYNC_META_PREFIX + key, value: iso });
    } catch {
      /* persistance best-effort */
    }
  }

  // Enchaîne un groupe de syncs séquentiellement (skip+continue). Retourne les libellés
  // (clés i18n) des sous-syncs échouées. Aucune commande backend nouvelle : on orchestre.
  async function runGroup(
    steps: SyncStepDef[],
    setState: (s: GroupState) => void,
  ): Promise<string[]> {
    setState({ ...IDLE_GROUP, running: true, total: steps.length });
    const failed: string[] = [];
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      setState({
        ...IDLE_GROUP,
        running: true,
        total: steps.length,
        index: i + 1,
        stepLabelKey: s.labelKey,
        failedKeys: [...failed],
      });
      try {
        await invoke(s.cmd);
      } catch {
        // Échec isolé : on continue le groupe, l'étape est collectée pour le récap.
        failed.push(s.labelKey);
      }
    }
    setState({
      running: false,
      stepLabelKey: null,
      index: steps.length,
      total: steps.length,
      failedKeys: failed,
      doneOk: failed.length === 0,
      donePartial: failed.length > 0,
    });
    return failed;
  }

  // « Tout synchroniser » : ordre global SÛR Wiki → Cargo & Carte → UEX (UEX lit
  // WikiStarmapLocation que Cargo & Carte remplit). CCU exclu (login interactif).
  async function runAllGroups() {
    setError(null);
    setAllResult(null);
    setAllRunning(true);
    try {
      const f1 = await runGroup(WIKI_STEPS, setWikiGroup);
      if (f1.length < WIKI_STEPS.length) await markSynced("wiki");
      const f2 = await runGroup(CARGO_STEPS, setCargoGroup);
      if (f2.length < CARGO_STEPS.length) await markSynced("cargo");
      const f3 = await runGroup(UEX_STEPS, setUexGroup);
      if (f3.length < UEX_STEPS.length) await markSynced("uex");
      setAllResult({ failedKeys: [...f1, ...f2, ...f3] });
    } finally {
      setAllRunning(false);
    }
  }

  // Synchronise UNE source depuis sa ligne du tableau de fraîcheur (bouton « Synchroniser »).
  // Enregistre l'horodatage si au moins une étape a réussi. CCU se gère à part (login interactif).
  async function runSource(key: SyncSourceKey) {
    const map = {
      wiki: [WIKI_STEPS, setWikiGroup] as const,
      cargo: [CARGO_STEPS, setCargoGroup] as const,
      uex: [UEX_STEPS, setUexGroup] as const,
    };
    const [steps, setState] = map[key];
    const failed = await runGroup(steps, setState);
    if (failed.length < steps.length) await markSynced(key);
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
