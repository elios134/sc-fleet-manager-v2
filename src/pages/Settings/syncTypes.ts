type SampledShip = { name: string; hardpoints: number };
type WikiSyncResult = {
  vehiclesSynced: number;
  hardpointsSynced: number;
  errors: number;
  sample: boolean;
  sampledShips: SampledShip[];
};
type ComponentSyncResult = { componentsSynced: number; errors: number; sample: boolean };
type CatalogSyncReport = { categories: number; items: number; prices: number; errors: string[] };
type ItemImageSyncReport = { pages: number; withImage: number; updated: number };
type VehicleSyncReport = {
  purchasePoints: number;
  rentalPoints: number;
  vehiclesPurchase: number;
  vehiclesRental: number;
};
type MissionSyncResult = { missionsSynced: number; errors: number };
type BlueprintSyncResult = {
  blueprintsSynced: number;
  missionLinksCreated: number;
  missionLinksSkipped: number;
  errors: number;
};
type StarmapSyncResult = {
  bodiesWritten: number;
  stanton: number;
  pyro: number;
  nyx: number;
  errors: number;
};

type SyncProgress = { phase: string; current: number; total: number };

type CcuSyncResult = {
  skusCount: number;
  upgradesCount: number;
  namesCount: number;
  errors: number;
  durationMs: number;
  cancelled: boolean;
  total: number;
  processed: number;
  pruned: number;
};
type CcuProgress = { current: number; total: number; fromShipId: number };

/* ── Synchronisations groupées (orchestration UI séquentielle, skip+continue) ──
 * Chaque groupe enchaîne des commandes backend INCHANGÉES dans l'ordre donné. Une
 * sous-sync qui échoue n'interrompt pas le groupe : elle est collectée et reportée à
 * la fin (même logique que l'onboarding). L'ordre INTRA-groupe est significatif pour
 * Cargo & Carte (Lieux remplit WikiStarmapLocation, relu ensuite par la Carte) ; et
 * l'ordre GLOBAL l'est aussi (UEX lit WikiStarmapLocation → Cargo & Carte doit précéder
 * UEX). CCU reste hors des groupes (login interactif, fenêtre RSI, verrou propre). */
type SyncStepDef = { cmd: string; labelKey: string };

type GroupState = {
  running: boolean;
  stepLabelKey: string | null; // étape en cours (clé i18n du libellé), pour l'affichage
  index: number; // étape courante (1-based)
  total: number;
  failedKeys: string[]; // libellés (clés i18n) des sous-syncs échouées
  doneOk: boolean;
  donePartial: boolean;
};

const IDLE_GROUP: GroupState = {
  running: false,
  stepLabelKey: null,
  index: 0,
  total: 0,
  failedKeys: [],
  doneOk: false,
  donePartial: false,
};

// Clé d'une SOURCE de données (une ligne du tableau de fraîcheur). L'horodatage de dernière
// sync est persisté en AppMeta sous `sync.lastSync.<key>` (relu au montage).
type SyncSourceKey = "wiki" | "cargo" | "uex" | "ccu";
const LAST_SYNC_META_PREFIX = "sync.lastSync.";
// Au-delà de ce délai, une source est signalée « périmé » (pastille ambre). En-dessous : à jour.
const STALE_AFTER_MS = 14 * 24 * 3600 * 1000;

export type { SampledShip, WikiSyncResult, ComponentSyncResult, CatalogSyncReport, ItemImageSyncReport, VehicleSyncReport, MissionSyncResult, BlueprintSyncResult, StarmapSyncResult, SyncProgress, CcuSyncResult, CcuProgress, SyncStepDef, GroupState, SyncSourceKey };
export { IDLE_GROUP, LAST_SYNC_META_PREFIX, STALE_AFTER_MS };
