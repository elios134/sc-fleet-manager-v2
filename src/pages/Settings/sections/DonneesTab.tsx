import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { openRsiLoginWindow, moveRsiWindowOffscreen } from "../../../lib/rsiSync";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { type TFunction } from "i18next";
import { Database, Boxes, Tags, Link2, RefreshCw, type LucideIcon } from "lucide-react";
import type { CargoReferenceSyncReport, UexSyncReport } from "../types";

/* ─────────────────────────── Onglet Données ─────────────────────────── */

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

type Freshness = { status: "ok" | "stale" | "never"; ageMs: number | null };
function freshnessOf(iso: string | null): Freshness {
  if (!iso) return { status: "never", ageMs: null };
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return { status: "never", ageMs: null };
  const ageMs = Date.now() - t;
  return { status: ageMs >= STALE_AFTER_MS ? "stale" : "ok", ageMs };
}

// « il y a X » localisé, granularité auto (min/heures/jours). null → tiret.
function relativeAge(ageMs: number | null, t: TFunction): string {
  if (ageMs == null) return "—";
  const min = Math.floor(ageMs / 60000);
  if (min < 1) return t("settings.donnees.freshness.justNow");
  if (min < 60) return t("settings.donnees.freshness.agoMinutes", { count: min });
  const hours = Math.floor(min / 60);
  if (hours < 24) return t("settings.donnees.freshness.agoHours", { count: hours });
  const days = Math.floor(hours / 24);
  return t("settings.donnees.freshness.agoDays", { count: days });
}

// Groupe « Données SC Wiki » : tables disjointes, même API → ordre interne libre.
const WIKI_STEPS: SyncStepDef[] = [
  { cmd: "sync_ship_data", labelKey: "settings.donnees.syncShipsBtn" },
  { cmd: "sync_components", labelKey: "settings.donnees.syncCompBtn" },
  { cmd: "sync_missions", labelKey: "settings.donnees.syncMissionsBtn" },
  { cmd: "sync_blueprints", labelKey: "settings.donnees.syncBlueprintsBtn" },
];

// Groupe « Cargo & Carte » : ORDRE OBLIGATOIRE. sync_cargo_reference (Lieux) remplit
// WikiStarmapLocation, relu par sync_starmap_from_wiki (Carte). Ne jamais inverser.
const CARGO_STEPS: SyncStepDef[] = [
  { cmd: "sync_cargo_reference", labelKey: "settings.donnees.cargoPositionsBtn" },
  { cmd: "sync_starmap_from_wiki", labelKey: "settings.donnees.syncStarmapWikiBtn" },
];

// Groupe « Catalogue UEX » : sync_item_images (SC Wiki) DOIT suivre sync_item_catalog,
// qui fait DELETE FROM Item puis réinsère → lancé avant, les imageUrl seraient écrasées.
const UEX_STEPS: SyncStepDef[] = [
  { cmd: "sync_uex_prices", labelKey: "settings.donnees.uexBtn" },
  { cmd: "sync_item_catalog", labelKey: "settings.donnees.catalogItemsBtn" },
  { cmd: "sync_vehicle_marketplace", labelKey: "settings.donnees.catalogVehiclesBtn" },
  { cmd: "sync_item_images", labelKey: "settings.donnees.catalogImagesBtn" },
];

// Pastille de fraîcheur : à jour (vert) / périmé (ambre) / jamais (gris) + « il y a X ».
function FreshnessPill({ fresh, ageMs }: { fresh: Freshness; ageMs: number | null }) {
  const { t } = useTranslation();
  const cfg =
    fresh.status === "ok"
      ? { label: t("settings.donnees.freshness.ok"), dot: "#2ee9a5", text: "text-emerald-300", border: "border-emerald-500/30", bg: "bg-emerald-500/10" }
      : fresh.status === "stale"
        ? { label: t("settings.donnees.freshness.stale"), dot: "#f59e0b", text: "text-amber-200", border: "border-amber-500/30", bg: "bg-amber-500/10" }
        : { label: t("settings.donnees.freshness.never"), dot: "rgba(255,255,255,0.35)", text: "text-white/50", border: "border-white/15", bg: "bg-white/5" };
  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${cfg.border} ${cfg.bg} ${cfg.text}`}>
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: cfg.dot }} />
        {cfg.label}
      </span>
      <span className="text-[11px] text-white/40">{relativeAge(ageMs, t)}</span>
    </div>
  );
}

// Ligne d'une SOURCE de données (tableau de fraîcheur) : icône + nom/description +
// pastille de fraîcheur + bouton Synchroniser. Affiche l'état du groupe (étape i/n, partiel)
// en dessous quand il tourne ou vient d'échouer partiellement.
function SourceRow({
  icon: Icon,
  iconBg,
  iconColor,
  name,
  desc,
  state,
  iso,
  onSync,
  disabled,
  running,
  accentBtn,
}: {
  icon: LucideIcon;
  iconBg: string;
  iconColor: string;
  name: ReactNode;
  desc: string;
  state: GroupState;
  iso: string | null;
  onSync: () => void;
  disabled: boolean;
  running: boolean;
  accentBtn?: boolean;
}) {
  const { t } = useTranslation();
  const fresh = freshnessOf(iso);
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
          style={{ background: iconBg, color: iconColor }}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-white">{name}</div>
          <div className="mt-0.5 text-[12px] leading-relaxed text-white/45">{desc}</div>
        </div>
        <FreshnessPill fresh={fresh} ageMs={fresh.ageMs} />
        <button
          onClick={onSync}
          disabled={disabled}
          className={[
            "inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
            accentBtn
              ? "border-amber-500/40 bg-amber-500/15 text-amber-100 hover:bg-amber-500/25"
              : "border-white/15 bg-white/5 text-white/80 hover:bg-white/10",
          ].join(" ")}
        >
          {running && (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          )}
          {t("settings.donnees.sourceSyncBtn")}
        </button>
      </div>

      {/* Progression / résultat du groupe, sous la ligne. */}
      {state.running && (
        <p className="mt-3 text-[12px] text-white/50">
          {t("settings.donnees.groupRunning", {
            step: state.stepLabelKey ? t(state.stepLabelKey) : "",
            index: state.index,
            total: state.total,
          })}
        </p>
      )}
      {!state.running && state.donePartial && (
        <p className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[12px] text-amber-200">
          {t("settings.donnees.groupPartial", {
            count: state.failedKeys.length,
            list: state.failedKeys.map((k) => t(k)).join(", "),
          })}
        </p>
      )}
    </div>
  );
}

// ── Store de sync persistant (hors composant) ──────────────────────────────
// PROBLÈME : la navigation démonte DonneesTab → l'état de sync (chargement/progression)
// et son rendu sont perdus alors que la sync continue côté Rust. Comme les listeners de
// progression sont créés DANS les handlers (portée fonction, pas useEffect), ils survivent
// au démontage ; il suffit que l'état vive AU NIVEAU MODULE et que le composant s'y abonne
// (useSyncExternalStore) → la sync reste visible et se met à jour live en revenant.
type DonneesState = {
  syncing: boolean; result: WikiSyncResult | null; error: string | null;
  syncingComp: boolean; compResult: ComponentSyncResult | null;
  syncingMissions: boolean; missionResult: MissionSyncResult | null;
  syncingBlueprints: boolean; blueprintResult: BlueprintSyncResult | null;
  syncingStarmapWiki: boolean; starmapResult: StarmapSyncResult | null;
  syncingCcu: boolean; ccuResult: CcuSyncResult | null; ccuProgress: CcuProgress | null;
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
  syncingCcu: false, ccuResult: null, ccuProgress: null,
  progress: null,
  syncingCargoPos: false, cargoPosResult: null,
  syncingUex: false, uexResult: null,
  syncingItemCat: false, itemCatResult: null,
  syncingVehMkt: false, vehMktResult: null,
  wikiGroup: IDLE_GROUP, cargoGroup: IDLE_GROUP, uexGroup: IDLE_GROUP,
  allRunning: false, allResult: null,
  advancedOpen: false,
  lastSync: { wiki: null, cargo: null, uex: null, ccu: null },
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
    syncingCcu: s.syncingCcu, setSyncingCcu: (v: boolean) => donneesSet("syncingCcu", v),
    ccuResult: s.ccuResult, setCcuResult: (v: CcuSyncResult | null) => donneesSet("ccuResult", v),
    ccuProgress: s.ccuProgress, setCcuProgress: (v: CcuProgress | null) => donneesSet("ccuProgress", v),
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

function DonneesTab() {
  const { t } = useTranslation();
  const {
    syncing, setSyncing, result, setResult, error, setError,
    syncingComp, setSyncingComp, compResult, setCompResult,
    syncingMissions, setSyncingMissions, missionResult, setMissionResult,
    syncingBlueprints, setSyncingBlueprints, blueprintResult, setBlueprintResult,
    syncingStarmapWiki, setSyncingStarmapWiki, starmapResult, setStarmapResult,
    syncingCcu, setSyncingCcu, ccuResult, setCcuResult, ccuProgress, setCcuProgress,
    progress, setProgress,
    syncingCargoPos, setSyncingCargoPos, cargoPosResult, setCargoPosResult,
    syncingUex, setSyncingUex, uexResult, setUexResult,
    syncingItemCat, setSyncingItemCat, itemCatResult, setItemCatResult,
    syncingVehMkt, setSyncingVehMkt, vehMktResult, setVehMktResult,
    wikiGroup, setWikiGroup, cargoGroup, setCargoGroup, uexGroup, setUexGroup,
    allRunning, setAllRunning, allResult, setAllResult,
    advancedOpen, setAdvancedOpen,
    lastSync, setLastSyncAt, setLastSyncAll,
  } = useDonneesSyncState();

  // Charge les horodatages de dernière sync (freshness) au montage — persistés en AppMeta.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const keys: SyncSourceKey[] = ["wiki", "cargo", "uex", "ccu"];
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
      const next: Record<SyncSourceKey, string | null> = { wiki: null, cargo: null, uex: null, ccu: null };
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
  async function runSource(key: Exclude<SyncSourceKey, "ccu">) {
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
  const syncStarmapWiki = () => runSync<StarmapSyncResult>("sync_starmap_from_wiki", setSyncingStarmapWiki, setStarmapResult);
  const syncStarmapRsi = () => runSync<StarmapSyncResult>("sync_starmap_from_rsi", setSyncingStarmapWiki, setStarmapResult);

  // Catalogue CCU : ouvre la webview rsi-login (session persistante du compte, comme
  // syncRsi), attend logged_in, PUIS lance sync_ccu_catalog (boucle ~238 vaisseaux,
  // plusieurs minutes, annulable). Progression via l'event ccu:sync-progress.
  async function syncCcu() {
    setSyncingCcu(true);
    setError(null);
    setCcuResult(null);
    setCcuProgress(null);
    let win: WebviewWindow | null = null;
    let un: UnlistenFn | null = null;
    try {
      const [accounts, activeId] = await Promise.all([
        invoke<Array<{ id: number | string; handle: string }>>("get_accounts"),
        invoke<string | null>("get_active_account_id"),
      ]);
      const active = accounts.find((a) => String(a.id) === String(activeId));
      if (!active) throw new Error(t("settings.comptes.errNoActiveAccount"));
      const handle = active.handle;

      // Même helper/dossier de session par compte que connexion + resync (anti-redivergence).
      win = await openRsiLoginWindow(handle, t("settings.comptes.ccuWindowTitle"));

      // Attend une session valide (silencieux si déjà connecté ; sinon login manuel).
      await new Promise<void>((resolve, reject) => {
        let interval: ReturnType<typeof setInterval>;
        let safety: ReturnType<typeof setTimeout>;
        let reloadedOnce = false;
        interval = setInterval(async () => {
          try {
            const res = await invoke<{ status: string }>("check_rsi_login_status");
            if (res.status === "logged_in") {
              clearInterval(interval);
              clearTimeout(safety);
              resolve();
            } else if (res.status === "session_expired" && !reloadedOnce) {
              reloadedOnce = true;
              await invoke("reload_rsi_login");
            } else if (res.status === "closed") {
              clearInterval(interval);
              clearTimeout(safety);
              reject(new Error(t("settings.comptes.errWindowClosed")));
            }
          } catch {
            /* poll non bloquant */
          }
        }, 2000);
        safety = setTimeout(() => {
          clearInterval(interval);
          reject(new Error(t("settings.comptes.errLoginExpired")));
        }, 300000);
      });

      // Session valide → plus d'interaction : on sort la fenêtre de l'écran (le sync
      // CCU pilote la webview en JS, invisible), fermée en fin de flux. Hors écran et
      // non .hide() car sync_ccu_catalog appelle win.navigate() (qui ré-afficherait
      // une fenêtre .hide()). ⚠️ à tester : si WebView2 throttle la fenêtre hors écran
      // sur cette boucle longue (~238 vaisseaux), il faudra désactiver le throttling.
      await moveRsiWindowOffscreen(win);

      un = await listen<CcuProgress>("ccu:sync-progress", (e) => setCcuProgress(e.payload));
      const res = await invoke<CcuSyncResult>("sync_ccu_catalog");
      setCcuResult(res);
      if (!res.cancelled) await markSynced("ccu");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (un) un();
      if (win) await win.close().catch(() => {});
      setCcuProgress(null);
      setSyncingCcu(false);
    }
  }

  async function cancelCcu() {
    try {
      await invoke("cancel_ccu_sync");
    } catch {
      /* best-effort */
    }
  }

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
  const anyBusy = individualBusy || groupBusy || syncingCcu;

  return (
    <div>
      <p className="text-sm leading-relaxed text-white/50">
        {t("settings.donnees.intro")} <strong>{t("settings.donnees.introBold")}</strong>{" "}
        {t("settings.donnees.introSuffix")}
        <br />
        <span className="text-white/40">{t("settings.donnees.introDuration")}</span>
      </p>

      {/* ── Tout synchroniser (hors CCU) : Wiki → Cargo & Carte → UEX ── */}
      <div className="mt-4">
        <button
          onClick={() => void runAllGroups()}
          disabled={anyBusy}
          className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/20 px-4 py-2.5 text-sm font-semibold text-emerald-100 transition-colors hover:bg-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {allRunning ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {allRunning ? t("settings.donnees.syncAllRunning") : t("settings.donnees.syncAllBtn")}
        </button>
        <p className="mt-2 text-xs text-white/40">{t("settings.donnees.syncAllHint")}</p>
        {allResult &&
          (allResult.failedKeys.length === 0 ? (
            <p className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300">
              {t("settings.donnees.syncAllDone")}
            </p>
          ) : (
            <p className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-200">
              {t("settings.donnees.syncAllPartial", {
                count: allResult.failedKeys.length,
                list: allResult.failedKeys.map((k) => t(k)).join(", "),
              })}
            </p>
          ))}
      </div>

      {/* ── Tableau de fraîcheur : une source = une ligne (statut + « il y a X » + bouton) ── */}
      <div className="mt-5 flex flex-col gap-2.5">
        <SourceRow
          icon={Database}
          iconBg="rgba(99,102,241,.14)"
          iconColor="var(--accent)"
          name={t("settings.donnees.sourceWikiName")}
          desc={t("settings.donnees.sourceWikiDesc")}
          state={wikiGroup}
          iso={lastSync.wiki}
          onSync={() => void runSource("wiki")}
          disabled={anyBusy}
          running={wikiGroup.running}
          accentBtn={freshnessOf(lastSync.wiki).status === "stale"}
        />
        <SourceRow
          icon={Boxes}
          iconBg="rgba(93,202,165,.14)"
          iconColor="#5dcaa5"
          name={t("settings.donnees.sourceCargoName")}
          desc={t("settings.donnees.sourceCargoDesc")}
          state={cargoGroup}
          iso={lastSync.cargo}
          onSync={() => void runSource("cargo")}
          disabled={anyBusy}
          running={cargoGroup.running}
          accentBtn={freshnessOf(lastSync.cargo).status === "stale"}
        />
        <SourceRow
          icon={Tags}
          iconBg="rgba(245,158,11,.14)"
          iconColor="#f59e0b"
          name={t("settings.donnees.sourceUexName")}
          desc={t("settings.donnees.sourceUexDesc")}
          state={uexGroup}
          iso={lastSync.uex}
          onSync={() => void runSource("uex")}
          disabled={anyBusy}
          running={uexGroup.running}
          accentBtn={freshnessOf(lastSync.uex).status === "stale"}
        />
        <SourceRow
          icon={Link2}
          iconBg="rgba(127,119,221,.14)"
          iconColor="#7f77dd"
          name={
            <>
              {t("settings.donnees.sourceCcuName")}{" "}
              <span className="text-[10px] font-medium text-white/35">
                {t("settings.donnees.sourceCcuNameNote")}
              </span>
            </>
          }
          desc={t("settings.donnees.sourceCcuDesc")}
          state={IDLE_GROUP}
          iso={lastSync.ccu}
          onSync={() => void syncCcu()}
          disabled={anyBusy}
          running={syncingCcu}
          accentBtn={freshnessOf(lastSync.ccu).status === "stale"}
        />
      </div>

      {/* Progression / annulation / résultat CCU (login interactif, boucle longue annulable). */}
      {(syncingCcu || ccuResult) && (
        <div className="mt-3">
          {syncingCcu && (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-[12px] text-white/50">
                {ccuProgress && ccuProgress.total > 0
                  ? t("settings.donnees.ccuSyncProgress", {
                      current: ccuProgress.current,
                      total: ccuProgress.total,
                    })
                  : t("settings.donnees.ccuSyncShort")}
              </span>
              <button
                onClick={() => void cancelCcu()}
                className="rounded-xl border border-red-500/40 bg-red-500/15 px-3 py-1.5 text-sm font-semibold text-red-200 transition-colors hover:bg-red-500/25"
              >
                {t("settings.datamining.cancelBtn")}
              </button>
            </div>
          )}
          {syncingCcu && ccuProgress && ccuProgress.total > 0 && (
            <div className="mt-3 h-1.5 w-full max-w-md overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full bg-indigo-400 transition-all"
                style={{ width: `${Math.round((ccuProgress.current / ccuProgress.total) * 100)}%` }}
              />
            </div>
          )}
          {ccuResult && (
            <p
              className={`mt-3 rounded-xl border px-4 py-2 text-sm ${
                ccuResult.cancelled
                  ? "border-accent/30 bg-accent/10 text-accent"
                  : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              }`}
            >
              {ccuResult.cancelled ? t("settings.donnees.ccuCancelledPrefix") : ""}
              {t("settings.donnees.ccuResult", {
                skus: ccuResult.skusCount,
                upgrades: ccuResult.upgradesCount,
                names: ccuResult.namesCount,
              })}
              {ccuResult.pruned > 0 ? t("settings.donnees.ccuPruned", { count: ccuResult.pruned }) : ""}
              {ccuResult.errors > 0
                ? t("settings.donnees.errorsSuffix", { errors: ccuResult.errors })
                : ""}
              {t("settings.donnees.ccuDuration", { sec: (ccuResult.durationMs / 1000).toFixed(0) })}
            </p>
          )}
        </div>
      )}

      {/* ── Sync avancée (repliable) : relancer une sync précise, individuellement ── */}
      <div className="mt-5 border-t border-white/10 pt-4">
        <button
          onClick={() => setAdvancedOpen((v) => !v)}
          className="flex w-full items-center justify-between rounded-xl px-1 py-1 text-left text-sm font-semibold text-white/80 transition-colors hover:text-white"
        >
          <span>
            {t("settings.donnees.advancedTitle")}
            <span className="ml-2 font-normal text-white/40">
              {t("settings.donnees.advancedHint")}
            </span>
          </span>
          <span className={`transition-transform ${advancedOpen ? "rotate-180" : ""}`}>▾</span>
        </button>

        {advancedOpen && (
          <div className="mt-2">
            <button
              onClick={() => void syncWiki()}
              disabled={anyBusy}
              className="mt-4 inline-flex items-center gap-2 rounded-xl border border-indigo-500/40 bg-indigo-500/20 px-4 py-2.5 text-sm font-semibold text-indigo-100 transition-colors hover:bg-indigo-500/30 disabled:cursor-not-allowed disabled:opacity-50"
            >
        {syncing && (
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
        )}
        {syncing
          ? progress && progress.phase === "vehicles" && progress.total > 0
            ? t("settings.donnees.syncShipsProgress", {
                current: progress.current,
                total: progress.total,
              })
            : t("settings.donnees.syncInProgress")
          : t("settings.donnees.syncShipsBtn")}
      </button>

      {result && (
        <div className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300">
          <p>
            {t("settings.donnees.shipsResult", {
              vehicles: result.vehiclesSynced,
              hardpoints: result.hardpointsSynced,
            })}
            {result.errors > 0 ? t("settings.donnees.errorsSuffix", { errors: result.errors }) : ""}
            {result.sample ? t("settings.donnees.sampleSuffix") : ""}
          </p>
          {result.sample && result.sampledShips && result.sampledShips.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs text-emerald-200/80">
              {result.sampledShips.map((s) => (
                <li key={s.name}>
                  • {t("settings.donnees.shipSlots", { name: s.name, hardpoints: s.hardpoints })}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Composants (/items) → Component + MissileStats. Alimente le Loadout Planner. */}
      <div className="mt-5 border-t border-white/10 pt-4">
        <p className="mb-3 text-sm leading-relaxed text-white/50">
          {t("settings.donnees.compIntro")} <strong>{t("settings.donnees.compIntroBold")}</strong>{" "}
          {t("settings.donnees.compIntroSuffix")}
        </p>
        <button
          onClick={() => void syncComponents()}
          disabled={anyBusy}
          className="inline-flex items-center gap-2 rounded-xl border border-indigo-500/40 bg-indigo-500/20 px-4 py-2.5 text-sm font-semibold text-indigo-100 transition-colors hover:bg-indigo-500/30 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {syncingComp && (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          )}
          {syncingComp
            ? progress && progress.phase === "components" && progress.total > 0
              ? t("settings.donnees.syncPageProgress", {
                  current: progress.current,
                  total: progress.total,
                })
              : t("settings.donnees.syncInProgress")
            : t("settings.donnees.syncCompBtn")}
        </button>
        {compResult && (
          <p className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300">
            {t("settings.donnees.compResult", { count: compResult.componentsSynced })}
            {compResult.errors > 0
              ? t("settings.donnees.errorsSuffix", { errors: compResult.errors })
              : ""}
            {compResult.sample ? t("settings.donnees.sampleSuffix") : ""}
          </p>
        )}
      </div>

      {/* Missions (/missions) → table Mission. Alimente la page Mission Intel. */}
      <div className="mt-5 border-t border-white/10 pt-4">
        <p className="mb-3 text-sm leading-relaxed text-white/50">
          {t("settings.donnees.missionsIntro")}{" "}
          <strong>{t("settings.donnees.missionsIntroBold")}</strong>{" "}
          {t("settings.donnees.missionsIntroSuffix")}
        </p>
        <button
          onClick={() => void syncMissions()}
          disabled={anyBusy}
          className="inline-flex items-center gap-2 rounded-xl border border-indigo-500/40 bg-indigo-500/20 px-4 py-2.5 text-sm font-semibold text-indigo-100 transition-colors hover:bg-indigo-500/30 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {syncingMissions && (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          )}
          {syncingMissions
            ? progress && progress.phase === "missions" && progress.total > 0
              ? t("settings.donnees.syncPageProgress", {
                  current: progress.current,
                  total: progress.total,
                })
              : t("settings.donnees.syncInProgress")
            : t("settings.donnees.syncMissionsBtn")}
        </button>
        {missionResult && (
          <p className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300">
            {t("settings.donnees.missionsResult", { count: missionResult.missionsSynced })}
            {missionResult.errors > 0
              ? t("settings.donnees.errorsSuffix", { errors: missionResult.errors })
              : ""}
          </p>
        )}
      </div>

      {/* Blueprints (/blueprints) → CraftingBlueprint. Alimente le Crafting Hub. */}
      <div className="mt-5 border-t border-white/10 pt-4">
        <p className="mb-3 text-sm leading-relaxed text-white/50">
          {t("settings.donnees.blueprintsIntro")}{" "}
          <strong>{t("settings.donnees.blueprintsIntroBold")}</strong>{" "}
          {t("settings.donnees.blueprintsIntroSuffix")}
        </p>
        <button
          onClick={() => void syncBlueprints()}
          disabled={anyBusy}
          className="inline-flex items-center gap-2 rounded-xl border border-indigo-500/40 bg-indigo-500/20 px-4 py-2.5 text-sm font-semibold text-indigo-100 transition-colors hover:bg-indigo-500/30 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {syncingBlueprints && (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          )}
          {syncingBlueprints
            ? progress && progress.phase === "blueprints" && progress.total > 0
              ? t("settings.donnees.syncPageProgress", {
                  current: progress.current,
                  total: progress.total,
                })
              : progress && progress.phase === "blueprint-missions" && progress.total > 0
                ? t("settings.donnees.syncBlueprintsLinks", {
                    current: progress.current,
                    total: progress.total,
                  })
                : t("settings.donnees.syncInProgress")
            : t("settings.donnees.syncBlueprintsBtn")}
        </button>
        {blueprintResult && (
          <p className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300">
            {t("settings.donnees.blueprintsResult", { count: blueprintResult.blueprintsSynced })}
            {t("settings.donnees.blueprintsLinks", { count: blueprintResult.missionLinksCreated })}
            {blueprintResult.missionLinksSkipped > 0
              ? t("settings.donnees.blueprintsLinksSkipped", {
                  count: blueprintResult.missionLinksSkipped,
                })
              : ""}
            {blueprintResult.errors > 0
              ? t("settings.donnees.errorsSuffix", { errors: blueprintResult.errors })
              : ""}
          </p>
        )}
      </div>

      {/* Carte galactique (StarmapBody) → source Wiki (réseau, dispo pour tous). */}
      <div className="mt-5 border-t border-white/10 pt-4">
        <p className="mb-3 text-sm leading-relaxed text-white/50">
          {t("settings.donnees.starmapIntro")}{" "}
          <strong>{t("settings.donnees.starmapIntroBold")}</strong>{" "}
          {t("settings.donnees.starmapIntroSuffix")}
        </p>
        <button
          onClick={() => void syncStarmapWiki()}
          disabled={anyBusy}
          className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/40 bg-cyan-500/20 px-4 py-2.5 text-sm font-semibold text-cyan-100 transition-colors hover:bg-cyan-500/30 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {syncingStarmapWiki && (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          )}
          {syncingStarmapWiki
            ? t("settings.donnees.syncInProgress")
            : t("settings.donnees.syncStarmapWikiBtn")}
        </button>
        <button
          onClick={() => void syncStarmapRsi()}
          disabled={anyBusy}
          className="ml-2 inline-flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/20 px-4 py-2.5 text-sm font-semibold text-amber-100 transition-colors hover:bg-amber-500/30 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {syncingStarmapWiki && (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          )}
          {syncingStarmapWiki
            ? t("settings.donnees.syncInProgress")
            : t("settings.donnees.syncStarmapRsiBtn")}
        </button>
        {starmapResult && (
          <p className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300">
            {t("settings.donnees.starmapResult", {
              count: starmapResult.bodiesWritten,
              stanton: starmapResult.stanton,
              pyro: starmapResult.pyro,
              nyx: starmapResult.nyx,
            })}
            {starmapResult.errors > 0
              ? t("settings.donnees.errorsSuffix", { errors: starmapResult.errors })
              : ""}
          </p>
        )}
      </div>

      {/* Cargo & Routes : positions (SC Wiki, distances) + prix/stock UEX (source primaire). */}
      <div className="mt-5 border-t border-white/10 pt-4">
        <p className="mb-3 text-sm leading-relaxed text-white/50">
          {t("settings.donnees.cargoIntro")} <strong>{t("settings.donnees.cargoIntroBold")}</strong>{" "}
          {t("settings.donnees.cargoIntroSuffix")}
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => void syncCargoPositions()}
            disabled={anyBusy}
            className="inline-flex items-center gap-2 rounded-xl border border-indigo-500/40 bg-indigo-500/20 px-4 py-2.5 text-sm font-semibold text-indigo-100 transition-colors hover:bg-indigo-500/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {syncingCargoPos && (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            )}
            {syncingCargoPos ? t("settings.donnees.syncInProgress") : t("settings.donnees.cargoPositionsBtn")}
          </button>
          <button
            onClick={() => void syncUex()}
            disabled={anyBusy}
            className="inline-flex items-center gap-2 rounded-xl border border-teal-500/40 bg-teal-500/20 px-4 py-2.5 text-sm font-semibold text-teal-100 transition-colors hover:bg-teal-500/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {syncingUex && (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            )}
            {syncingUex ? t("settings.donnees.syncInProgress") : t("settings.donnees.uexBtn")}
          </button>
        </div>
        {cargoPosResult && (
          <p className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300">
            {t("settings.donnees.cargoPositionsResult", {
              positions: cargoPosResult.positions,
              hubs: cargoPosResult.auditHubsMatched,
              hubsTotal: cargoPosResult.auditHubsTotal,
            })}
          </p>
        )}
        {uexResult && (
          <p className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300">
            {t("settings.donnees.uexResult", {
              prices: uexResult.prices,
              terminals: uexResult.terminals,
              mapped: uexResult.terminalsMapped,
              hubs: uexResult.hubsMatched,
              hubsTotal: uexResult.hubsTotal,
            })}
          </p>
        )}
      </div>

      {/* Catalogue : items vendus in-game (UEX) + marché des vaisseaux (achat/location aUEC). */}
      <div className="mt-5 border-t border-white/10 pt-4">
        <p className="mb-3 text-sm leading-relaxed text-white/50">
          {t("settings.donnees.catalogIntro")} <strong>{t("settings.donnees.catalogIntroBold")}</strong>{" "}
          {t("settings.donnees.catalogIntroSuffix")}
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => void syncItemCatalog()}
            disabled={anyBusy}
            className="inline-flex items-center gap-2 rounded-xl border border-teal-500/40 bg-teal-500/20 px-4 py-2.5 text-sm font-semibold text-teal-100 transition-colors hover:bg-teal-500/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {syncingItemCat && (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            )}
            {syncingItemCat ? t("settings.donnees.syncInProgress") : t("settings.donnees.catalogItemsBtn")}
          </button>
          <button
            onClick={() => void syncVehicleMarketplace()}
            disabled={anyBusy}
            className="inline-flex items-center gap-2 rounded-xl border border-teal-500/40 bg-teal-500/20 px-4 py-2.5 text-sm font-semibold text-teal-100 transition-colors hover:bg-teal-500/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {syncingVehMkt && (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            )}
            {syncingVehMkt ? t("settings.donnees.syncInProgress") : t("settings.donnees.catalogVehiclesBtn")}
          </button>
          <button
            onClick={() => void syncItemImages()}
            disabled={anyBusy || syncingItemImg}
            className="inline-flex items-center gap-2 rounded-xl border border-teal-500/40 bg-teal-500/20 px-4 py-2.5 text-sm font-semibold text-teal-100 transition-colors hover:bg-teal-500/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {syncingItemImg && (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            )}
            {syncingItemImg ? t("settings.donnees.syncInProgress") : t("settings.donnees.catalogImagesBtn")}
          </button>
        </div>
        {itemImgResult && (
          <p className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300">
            {t("settings.donnees.catalogImagesResult", { updated: itemImgResult.updated, withImage: itemImgResult.withImage })}
          </p>
        )}
        {itemCatResult && (
          <p className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300">
            {t("settings.donnees.catalogItemsResult", {
              items: itemCatResult.items,
              categories: itemCatResult.categories,
              prices: itemCatResult.prices,
            })}
            {itemCatResult.errors.length > 0
              ? t("settings.donnees.errorsSuffix", { errors: itemCatResult.errors.length })
              : ""}
          </p>
        )}
        {vehMktResult && (
          <p className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300">
            {t("settings.donnees.catalogVehiclesResult", {
              buy: vehMktResult.vehiclesPurchase,
              buyPoints: vehMktResult.purchasePoints,
              rent: vehMktResult.vehiclesRental,
              rentPoints: vehMktResult.rentalPoints,
            })}
          </p>
        )}
            </div>
          </div>
        )}
      </div>

      {error && (
        <p className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}

/* ─────────────────────────── Onglet Langue ─────────────────────────── */

// Sélecteur FR/EN : applique la langue immédiatement (i18next) + persiste en AppMeta.

export { DonneesTab };
