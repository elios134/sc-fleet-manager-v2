import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { openRsiLoginWindow, moveRsiWindowOffscreen } from "../../../lib/rsiSync";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { Database, Boxes, Tags, Link2, RefreshCw } from "lucide-react";
import type { CargoReferenceSyncReport, UexSyncReport } from "../types";
import { useDonneesSyncState } from "../hooks/useDonneesSync";
import { SourceRow, freshnessOf } from "../components/SourceRow";
import { IDLE_GROUP, LAST_SYNC_META_PREFIX } from "../syncTypes";
import type { WikiSyncResult, ComponentSyncResult, CatalogSyncReport, ItemImageSyncReport, VehicleSyncReport, MissionSyncResult, BlueprintSyncResult, StarmapSyncResult, SyncProgress, CcuSyncResult, CcuProgress, SyncStepDef, GroupState, SyncSourceKey } from "../syncTypes";

/* ─────────────────────────── Onglet Données ─────────────────────────── */

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
