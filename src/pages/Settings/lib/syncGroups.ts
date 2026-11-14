// Groupes de synchro par source (wiki, cargo, uex), partagés entre les boutons de Réglages › Données
// et la synchro automatique du lancement. L'état vit dans le store de useDonneesSync : une synchro
// auto en cours apparaît sur les lignes de sources et désactive les boutons (aucun chevauchement).
import { invoke } from "@tauri-apps/api/core";
import { donneesSet } from "../hooks/useDonneesSync";
import { IDLE_GROUP, LAST_SYNC_META_PREFIX } from "../syncTypes";
import type { GroupState, SyncSourceKey, SyncStepDef } from "../syncTypes";

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

export const GROUP_STEPS: Record<SyncSourceKey, SyncStepDef[]> = { wiki: WIKI_STEPS, cargo: CARGO_STEPS, uex: UEX_STEPS };
const GROUP_STATE = { wiki: "wikiGroup", cargo: "cargoGroup", uex: "uexGroup" } as const;

/** Date la dernière synchro d'une source (store + AppMeta persistant). */
async function markSynced(key: SyncSourceKey) {
  const iso = new Date().toISOString();
  donneesSet("lastSync", (p) => ({ ...p, [key]: iso }));
  try {
    await invoke("set_app_meta", { key: LAST_SYNC_META_PREFIX + key, value: iso });
  } catch {
    /* persistance best-effort */
  }
}

/** Enchaîne les étapes d'un groupe (skip+continue) et renvoie les libellés des étapes échouées. */
async function runGroup(steps: SyncStepDef[], setState: (s: GroupState) => void): Promise<string[]> {
  setState({ ...IDLE_GROUP, running: true, total: steps.length });
  const failed: string[] = [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    setState({ ...IDLE_GROUP, running: true, total: steps.length, index: i + 1, stepLabelKey: s.labelKey, failedKeys: [...failed] });
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

/** Synchronise une source ; la date si au moins une étape a réussi. Renvoie les étapes échouées. */
export async function runSourceGroup(key: SyncSourceKey): Promise<string[]> {
  const steps = GROUP_STEPS[key];
  const failed = await runGroup(steps, (s) => donneesSet(GROUP_STATE[key], s));
  if (failed.length < steps.length) await markSynced(key);
  return failed;
}
