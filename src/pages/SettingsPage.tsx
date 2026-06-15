import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { runRsiSync, openRsiLoginWindow } from "../lib/rsiSync";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  applyAccent,
  DEFAULT_ACCENT,
  DEFAULT_ANIMATIONS,
  DEFAULT_HUD_INTENSITY,
  type AppSettings,
} from "../hooks/useAppSettings";
import { FEATURE_ITEMS } from "../components/Layout";
import { AddAccountModal } from "../components/AddAccountModal";
import { useDatamining, phaseLabel } from "../contexts/DataminingContext";
import { MANUFACTURER_THEMES } from "../constants/manufacturerThemes";
import { isEnabled as autostartIsEnabled, enable as autostartEnable, disable as autostartDisable } from "@tauri-apps/plugin-autostart";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { useTranslation } from "react-i18next";
import { setLanguage } from "../i18n/language";
import { SUPPORTED_LANGS } from "../i18n";

type Account = {
  id: number;
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
};

type NotifSettings = {
  insuranceExpiryThreshold: number;
  notifFleetStatus: boolean;
  notifMarketVolatility: boolean;
  notifSystemMessages: boolean;
  notifInApp: boolean;
  notifSystem: boolean;
  notifMinedMissions: boolean;
  notifInsuranceExpired: boolean;
  autoPatchDetect: boolean;
};

export default function SettingsPage() {
  const { t } = useTranslation();
  return (
    <div className="p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-white">{t("settings.page.title")}</h1>
        <p className="mt-1 text-sm text-white/50">{t("settings.page.subtitle")}</p>
      </header>

      {/* Page unique scrollable : sections en encarts titrés, sur 2 colonnes (responsive). */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Section
          className="lg:col-span-2"
          title={t("settings.langue.sectionTitle")}
          subtitle={t("settings.langue.sectionSubtitle")}
        >
          <LanguageTab />
        </Section>
        <Section
          className="lg:col-span-2"
          title={t("settings.comptes.sectionTitle")}
          subtitle={t("settings.comptes.sectionSubtitle")}
        >
          <ComptesTab />
        </Section>
        <Section
          title={t("settings.donnees.sectionTitle")}
          subtitle={t("settings.donnees.sectionSubtitle")}
        >
          <DonneesTab />
        </Section>
        <Section
          title={t("settings.navbar.sectionTitle")}
          subtitle={t("settings.navbar.sectionSubtitle")}
        >
          <NavbarTab />
        </Section>
        <Section
          title={t("settings.hud.sectionTitle")}
          subtitle={t("settings.hud.sectionSubtitle")}
        >
          <HudTab />
        </Section>
        <Section
          title={t("settings.notif.sectionTitle")}
          subtitle={t("settings.notif.sectionSubtitle")}
        >
          <NotificationsTab />
        </Section>
        <Section
          className="lg:col-span-2"
          title={t("settings.datamining.sectionTitle")}
          subtitle={t("settings.datamining.sectionSubtitle")}
        >
          <DataminingTab />
        </Section>
        <Section
          title={t("settings.apropos.sectionTitle")}
          subtitle={t("settings.apropos.sectionSubtitle")}
        >
          <AProposTab />
        </Section>
        <Section
          title={t("settings.diagnostic.sectionTitle")}
          subtitle={t("settings.diagnostic.sectionSubtitle")}
        >
          <DiagnosticTab />
        </Section>
      </div>
    </div>
  );
}

function Section({
  title,
  subtitle,
  className,
  children,
}: {
  title: string;
  subtitle?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={[
        "rounded-2xl border border-white/10 bg-white/[0.025] p-5 backdrop-blur-sm",
        className ?? "",
      ].join(" ")}
    >
      <div className="mb-4 border-b border-white/10 pb-3">
        <h2 className="text-base font-semibold text-white">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-white/50">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

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

function DonneesTab() {
  const { t } = useTranslation();
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<WikiSyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [syncingComp, setSyncingComp] = useState(false);
  const [compResult, setCompResult] = useState<ComponentSyncResult | null>(null);

  const [syncingMissions, setSyncingMissions] = useState(false);
  const [missionResult, setMissionResult] = useState<MissionSyncResult | null>(null);

  const [syncingBlueprints, setSyncingBlueprints] = useState(false);
  const [blueprintResult, setBlueprintResult] = useState<BlueprintSyncResult | null>(null);

  const [syncingStarmap, setSyncingStarmap] = useState(false);
  const [starmapResult, setStarmapResult] = useState<StarmapSyncResult | null>(null);

  const [syncingCcu, setSyncingCcu] = useState(false);
  const [ccuResult, setCcuResult] = useState<CcuSyncResult | null>(null);
  const [ccuProgress, setCcuProgress] = useState<CcuProgress | null>(null);

  // Progression remontée par le backend (event wiki:sync-progress) pendant la sync.
  const [progress, setProgress] = useState<SyncProgress | null>(null);

  async function syncWiki() {
    setSyncing(true);
    setError(null);
    setResult(null);
    setProgress(null);
    const un = await listen<SyncProgress>("wiki:sync-progress", (e) => setProgress(e.payload));
    try {
      const res = await invoke<WikiSyncResult>("sync_ship_data");
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      un();
      setProgress(null);
      setSyncing(false);
    }
  }

  async function syncComponents() {
    setSyncingComp(true);
    setError(null);
    setCompResult(null);
    setProgress(null);
    const un = await listen<SyncProgress>("wiki:sync-progress", (e) => setProgress(e.payload));
    try {
      const res = await invoke<ComponentSyncResult>("sync_components");
      setCompResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      un();
      setProgress(null);
      setSyncingComp(false);
    }
  }

  async function syncMissions() {
    setSyncingMissions(true);
    setError(null);
    setMissionResult(null);
    setProgress(null);
    const un = await listen<SyncProgress>("wiki:sync-progress", (e) => setProgress(e.payload));
    try {
      const res = await invoke<MissionSyncResult>("sync_missions");
      setMissionResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      un();
      setProgress(null);
      setSyncingMissions(false);
    }
  }

  async function syncBlueprints() {
    setSyncingBlueprints(true);
    setError(null);
    setBlueprintResult(null);
    setProgress(null);
    const un = await listen<SyncProgress>("wiki:sync-progress", (e) => setProgress(e.payload));
    try {
      const res = await invoke<BlueprintSyncResult>("sync_blueprints");
      setBlueprintResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      un();
      setProgress(null);
      setSyncingBlueprints(false);
    }
  }

  // Carte galactique : indépendante des blueprints (datamining starmap), pas de progression.
  async function syncStarmap() {
    setSyncingStarmap(true);
    setError(null);
    setStarmapResult(null);
    try {
      const res = await invoke<StarmapSyncResult>("sync_starmap");
      setStarmapResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncingStarmap(false);
    }
  }

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

      un = await listen<CcuProgress>("ccu:sync-progress", (e) => setCcuProgress(e.payload));
      const res = await invoke<CcuSyncResult>("sync_ccu_catalog");
      setCcuResult(res);
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

  return (
    <div>
      <p className="text-sm leading-relaxed text-white/50">
        {t("settings.donnees.intro")} <strong>{t("settings.donnees.introBold")}</strong>{" "}
        {t("settings.donnees.introSuffix")}
        <br />
        <span className="text-white/40">{t("settings.donnees.introDuration")}</span>
      </p>

      <button
        onClick={() => void syncWiki()}
        disabled={syncing}
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
          disabled={syncingComp}
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
          disabled={syncingMissions}
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
          disabled={syncingBlueprints}
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

      {/* Carte galactique (StarmapBody) → datamining, indépendant des blueprints. */}
      <div className="mt-5 border-t border-white/10 pt-4">
        <p className="mb-3 text-sm leading-relaxed text-white/50">
          {t("settings.donnees.starmapIntro")}{" "}
          <strong>{t("settings.donnees.starmapIntroBold")}</strong>{" "}
          {t("settings.donnees.starmapIntroSuffix")}
        </p>
        <button
          onClick={() => void syncStarmap()}
          disabled={syncingStarmap}
          className="inline-flex items-center gap-2 rounded-xl border border-indigo-500/40 bg-indigo-500/20 px-4 py-2.5 text-sm font-semibold text-indigo-100 transition-colors hover:bg-indigo-500/30 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {syncingStarmap && (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          )}
          {syncingStarmap
            ? t("settings.donnees.syncInProgress")
            : t("settings.donnees.syncStarmapBtn")}
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

      {/* Catalogue CCU → sync RSI (GraphQL filterShips), session persistante du compte. */}
      <div className="mt-5 border-t border-white/10 pt-4">
        <p className="mb-3 text-sm leading-relaxed text-white/50">
          {t("settings.donnees.ccuIntro")} <strong>{t("settings.donnees.ccuIntroBold")}</strong>{" "}
          {t("settings.donnees.ccuIntroSuffix")}{" "}
          <span className="text-white/40">{t("settings.donnees.ccuIntroNote")}</span>
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => void syncCcu()}
            disabled={syncingCcu}
            className="inline-flex items-center gap-2 rounded-xl border border-indigo-500/40 bg-indigo-500/20 px-4 py-2.5 text-sm font-semibold text-indigo-100 transition-colors hover:bg-indigo-500/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {syncingCcu && (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            )}
            {syncingCcu
              ? ccuProgress && ccuProgress.total > 0
                ? t("settings.donnees.ccuSyncProgress", {
                    current: ccuProgress.current,
                    total: ccuProgress.total,
                  })
                : t("settings.donnees.ccuSyncShort")
              : t("settings.donnees.syncCcuBtn")}
          </button>
          {syncingCcu && (
            <button
              onClick={() => void cancelCcu()}
              className="rounded-xl border border-red-500/40 bg-red-500/15 px-3 py-2 text-sm font-semibold text-red-200 transition-colors hover:bg-red-500/25"
            >
              {t("settings.datamining.cancelBtn")}
            </button>
          )}
        </div>
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
                ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
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

      {error && (
        <p className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}

/* ──────────────────── Personnaliser la nav bar ──────────────────── */

const MAX_PINNED = 3;

function NavbarTab() {
  const { t } = useTranslation();
  const [pinned, setPinned] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    invoke<string[]>("get_pinned_nav")
      .then((p) => {
        if (!cancelled) setPinned(p);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const atMax = pinned.length >= MAX_PINNED;

  async function toggle(route: string) {
    const isPinned = pinned.includes(route);
    let next: string[];
    if (isPinned) {
      next = pinned.filter((r) => r !== route);
    } else {
      if (atMax) return;
      next = [...pinned, route];
    }
    setPinned(next);
    try {
      await invoke("set_pinned_nav", { routes: next });
      await emit("navbar:pinned-changed");
    } catch {
      /* best-effort */
    }
  }

  return (
    <div>
      <p className="mb-3 text-sm text-white/50">
        {t("settings.navbar.intro", { max: MAX_PINNED })}
      </p>
      <div className="flex flex-col gap-2">
        {FEATURE_ITEMS.map((item) => {
          const isPinned = pinned.includes(item.to);
          const disabled = !isPinned && atMax;
          const Icon = item.icon;
          return (
            <div
              key={item.to}
              className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/5 px-3 py-2"
            >
              <div className="flex items-center gap-2.5">
                <Icon className="h-4 w-4 text-white/60" />
                <span className="text-sm text-white">{t(item.labelKey)}</span>
              </div>
              <button
                role="switch"
                aria-checked={isPinned}
                disabled={disabled}
                onClick={() => void toggle(item.to)}
                className={[
                  "relative h-6 w-11 shrink-0 rounded-full transition-colors",
                  isPinned ? "bg-[var(--accent)]" : "bg-white/15",
                  disabled ? "cursor-not-allowed opacity-40" : "",
                ].join(" ")}
              >
                <span
                  className={[
                    "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all",
                    isPinned ? "left-[22px]" : "left-0.5",
                  ].join(" ")}
                />
              </button>
            </div>
          );
        })}
      </div>
      {atMax && (
        <p className="mt-3 text-xs font-medium text-amber-400/80">
          {t("settings.navbar.maxReached", { max: MAX_PINNED })}
        </p>
      )}
    </div>
  );
}

/* ─────────────────────────── Onglet Langue ─────────────────────────── */

// Sélecteur FR/EN : applique la langue immédiatement (i18next) + persiste en AppMeta.
function LanguageTab() {
  const { t, i18n } = useTranslation();
  const current = i18n.language;
  const LABELS: Record<string, string> = {
    fr: t("settings.langue.optionFr"),
    en: t("settings.langue.optionEn"),
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        {SUPPORTED_LANGS.map((lng) => {
          const active = current === lng;
          return (
            <button
              key={lng}
              type="button"
              onClick={() => void setLanguage(lng)}
              className={[
                "rounded-xl border px-4 py-2 text-sm font-medium transition-colors",
                active
                  ? "border-[var(--accent)] bg-[var(--accent-muted)] text-white"
                  : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10",
              ].join(" ")}
            >
              {LABELS[lng] ?? lng}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────────────────────── Onglet Comptes ─────────────────────────── */

type RsiSessionStatus = {
  hasToken: boolean;
  portraitUrl: string | null;
  conciergeLevel: string | null;
  conciergeProgress: number | null;
};

function ComptesTab() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Record<string, RsiSessionStatus>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Account | null>(null);
  const [editTarget, setEditTarget] = useState<Account | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const loadSession = useCallback(async (handle: string) => {
    try {
      const status = await invoke<RsiSessionStatus>("get_rsi_session_status", { handle });
      setSessions((prev) => ({ ...prev, [handle]: status }));
    } catch {
      /* statut non bloquant */
    }
  }, []);

  const reload = useCallback(async () => {
    try {
      const [list, active] = await Promise.all([
        invoke<Account[]>("get_accounts"),
        invoke<string | null>("get_active_account_id"),
      ]);
      setAccounts(list);
      setActiveId(active);
      await Promise.all(list.map((a) => loadSession(a.handle)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [loadSession]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Écoute des événements RSI émis par le backend.
  useEffect(() => {
    const pending: Array<Promise<UnlistenFn>> = [
      listen<{ handle: string }>("rsi:login-success", (e) => {
        setNotice(t("settings.comptes.noticeLoginSuccess", { handle: e.payload.handle }));
        void loadSession(e.payload.handle);
      }),
      listen<{ reason: string }>("rsi:login-error", (e) => {
        setNotice(t("settings.comptes.noticeLoginError", { reason: e.payload.reason }));
      }),
      listen("rsi:login-timeout", () => {
        setNotice(t("settings.comptes.noticeLoginTimeout"));
      }),
      listen<{ handle: string }>("rsi:logout", (e) => {
        void loadSession(e.payload.handle);
      }),
    ];
    return () => {
      pending.forEach((p) => void p.then((un) => un()));
    };
  }, [loadSession]);

  async function activate(id: number) {
    try {
      await invoke("set_active_account", { accountId: String(id) });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  // Suppression confirmée via la modale : laisse l'erreur remonter pour que la
  // modale l'affiche (et reste ouverte) ; ferme/redirige seulement en cas de succès.
  async function confirmDelete() {
    if (!deleteTarget) return;
    const wasActive = String(deleteTarget.id) === activeId;
    await invoke("delete_account", { accountId: String(deleteTarget.id) });
    if (wasActive) {
      navigate("/");
      return;
    }
    await reload();
    setDeleteTarget(null);
  }

  // Connexion RSI AUTOMATIQUE (calqué V1) : ouvre la fenêtre sur /account/pledges et
  // poll ; dès que connecté + page pledges prête → stocke la session, scrape le
  // hangar (contournement Cloudflare), sync la flotte, ferme la fenêtre. Recharge
  // auto en cas de "session expired". On reste dans Settings (pas de navigate).
  async function connectRsi(handle: string) {
    setError(null);
    setNotice(t("settings.comptes.noticeConnectPrompt"));
    try {
      // Fenêtre à session PERSISTANTE et ISOLÉE par compte (même helper/dataDirectory
      // que le resync) : la connexion alimente le dossier rsi-<handle> que le resync
      // rouvrira ensuite. Plus d'incognito — c'était la cause A de la session partagée.
      const win = await openRsiLoginWindow(handle, t("settings.comptes.loginWindowTitle"));
      {
        let interval: ReturnType<typeof setInterval>;
        let safety: ReturnType<typeof setTimeout>;
        let reloadedOnce = false;
        let busy = false;
        // Refresh auto initial à 3s (évite le refresh manuel sur "session expired").
        const refreshTimer = setTimeout(() => {
          void invoke("reload_rsi_login").catch(() => {});
        }, 3000);
        const stop = () => {
          clearInterval(interval);
          clearTimeout(safety);
          clearTimeout(refreshTimer);
        };
        interval = setInterval(async () => {
          if (busy) return;
          try {
            const res = await invoke<{ status: string }>("check_rsi_login_status");
            if (res.status === "logged_in") {
              busy = true;
              stop();
              await invoke("extract_and_store_rsi_session", { handle });
              try {
                setNotice(t("settings.comptes.noticeScraping"));
                // Fix B : la session chargée doit être celle de `handle` (sinon abort).
                const result = await invoke<{ pledges: unknown[]; handle: string | null }>(
                  "scrape_rsi_hangar",
                  { expectedHandle: handle },
                );
                // Concierge (best-effort), fenêtre encore ouverte.
                try {
                  await invoke("scrape_rsi_concierge", { handle });
                } catch (e) {
                  console.error("scrape concierge échoué (ignoré)", e);
                }
                await invoke("sync_fleet_from_scrape", { handle, pledges: result.pledges });
                await emit("fleet:synced");
              } catch (e) {
                console.error("scrape après connexion échoué", e);
              }
              await win.close().catch(() => {});
              void loadSession(handle);
              setNotice(t("settings.comptes.noticeLoginSuccess", { handle }));
            } else if (res.status === "session_expired" && !reloadedOnce) {
              reloadedOnce = true;
              setNotice(t("settings.comptes.noticeSessionExpired"));
              await invoke("reload_rsi_login");
            } else if (res.status === "closed") {
              stop();
            }
          } catch (e) {
            console.error("poll error", e);
          }
        }, 2000);
        safety = setTimeout(() => clearInterval(interval), 300000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function disconnectRsi(handle: string) {
    try {
      // Supprime les tokens AppMeta du compte. NB : depuis le Fix A, la session
      // webview est persistante par compte (dossier rsi-<handle>) ; les cookies RSI
      // ne sont pas purgés ici (la déconnexion réelle du jar reste un lot à part).
      await invoke("logout_rsi", { handle });
      await loadSession(handle);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  // Synchronisation RSI : délègue au flux partagé (src/lib/rsiSync.ts), réutilisé aussi par
  // le bouton « Sync RSI » de Ma Flotte. Comportement identique à avant (notices d'étape,
  // refresh du badge concierge, message de fin). Fenêtre à session PERSISTANTE par compte.
  async function syncRsi(handle: string) {
    setError(null);
    setSyncing(true);
    try {
      const res = await runRsiSync(handle, setNotice);
      void loadSession(handle); // rafraîchit le badge concierge après resync
      setNotice(
        t("settings.comptes.syncDone", {
          imported: res.imported,
          adopted: res.adopted,
          deleted: res.deleted,
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div>
      {error && (
        <p className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          {error}
        </p>
      )}
      {notice && (
        <p className="mb-4 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70">
          {notice}
        </p>
      )}

      <div className="flex flex-col gap-3">
        {accounts.map((acc) => {
          const isActive = String(acc.id) === activeId;
          const session = sessions[acc.handle];
          const hasToken = session?.hasToken ?? false;
          const portraitUrl = session?.portraitUrl ?? null;
          const conciergeLevel = session?.conciergeLevel ?? null;
          return (
            <div
              key={acc.id}
              className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-4"
            >
              {hasToken && portraitUrl ? (
                <img
                  src={portraitUrl}
                  alt={acc.handle}
                  className="h-10 w-10 shrink-0 rounded-full object-cover"
                />
              ) : (
                <span className="h-10 w-10 shrink-0 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600" />
              )}

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-medium text-white">{acc.handle}</span>
                  {isActive && (
                    <span className="rounded-full bg-[var(--accent-muted)] px-2 py-0.5 text-[10px] font-semibold text-[var(--accent)]">
                      {t("settings.comptes.badgeActive")}
                    </span>
                  )}
                  {hasToken ? (
                    <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                      {t("settings.comptes.badgeSessionActive")}
                    </span>
                  ) : (
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-white/50">
                      {t("settings.comptes.badgeNotConnected")}
                    </span>
                  )}
                </div>
                {acc.displayName && (
                  <span className="block truncate text-sm text-white/50">{acc.displayName}</span>
                )}
                {conciergeLevel && (
                  <span className="mt-0.5 block truncate text-xs font-medium text-[var(--accent)]">
                    ◆ {t("settings.comptes.conciergePrefix", { level: conciergeLevel })}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {hasToken ? (
                  <>
                    <button
                      onClick={() => syncRsi(acc.handle)}
                      disabled={syncing}
                      className="rounded-lg border border-emerald-500/30 bg-emerald-500/15 px-3 py-1.5 text-sm font-medium text-emerald-300 transition-colors hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {syncing
                        ? t("settings.comptes.btnSyncing")
                        : t("settings.comptes.btnSyncRsi")}
                    </button>
                    <button
                      onClick={() => disconnectRsi(acc.handle)}
                      className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white/80 transition-colors hover:bg-white/10"
                    >
                      {t("settings.comptes.btnDisconnect")}
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => connectRsi(acc.handle)}
                    className="rounded-lg border border-indigo-500/30 bg-indigo-500/15 px-3 py-1.5 text-sm font-medium text-indigo-300 transition-colors hover:bg-indigo-500/25"
                  >
                    {t("settings.comptes.btnConnectRsi")}
                  </button>
                )}
                {!isActive && (
                  <button
                    onClick={() => activate(acc.id)}
                    className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white/80 transition-colors hover:bg-white/10"
                  >
                    {t("settings.comptes.btnActivateAccount")}
                  </button>
                )}
                <button
                  onClick={() => setEditTarget(acc)}
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white/80 transition-colors hover:bg-white/10"
                >
                  {t("settings.comptes.btnModify")}
                </button>
                <button
                  onClick={() => setDeleteTarget(acc)}
                  className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-sm font-medium text-red-300 transition-colors hover:bg-red-500/20"
                >
                  {t("settings.comptes.btnDeleteAccount")}
                </button>
              </div>
            </div>
          );
        })}

        {accounts.length === 0 && (
          <p className="text-sm text-white/40">{t("settings.comptes.noneRegistered")}</p>
        )}
      </div>

      <button
        onClick={() => setAddOpen(true)}
        className="mt-4 text-sm font-medium text-[var(--accent)] hover:underline"
      >
        {t("settings.comptes.addAccountBtn")}
      </button>

      {deleteTarget && (
        <DeleteAccountConfirmModal
          account={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={confirmDelete}
        />
      )}

      {editTarget && (
        <EditAccountModal
          account={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={async () => {
            await reload();
            await emit("account:updated"); // l'AccountSwitcher (topbar) se recale
            setEditTarget(null);
          }}
        />
      )}

      {addOpen && (
        <AddAccountModal
          onClose={() => setAddOpen(false)}
          onCreated={async () => {
            // create_account auto-active le nouveau compte : on rafraîchit la liste
            // locale et on prévient la topbar (account:updated recale liste + actif)
            // + les écouteurs du compte actif (cloche…) via account:switched.
            await reload();
            await emit("account:updated");
            await emit("account:switched");
            setAddOpen(false);
          }}
        />
      )}
    </div>
  );
}

/* ──────────────────── Modale confirmation suppression compte ──────────────────── */

function DeleteAccountConfirmModal({
  account,
  onClose,
  onConfirm,
}: {
  account: Account;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handle() {
    setDeleting(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDeleting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative z-10 w-full max-w-sm rounded-2xl border border-red-500/30 p-6 backdrop-blur-2xl"
        style={{ background: "rgba(20,20,28,0.92)" }}
      >
        <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-red-300">
          {t("settings.comptes.deleteModalTitle")}
        </p>
        <p className="mb-2 text-sm text-white/80">
          {t("settings.comptes.deleteModalQuestion")}{" "}
          <span className="font-mono font-bold text-white">@{account.handle}</span> ?
        </p>
        <p className="mb-5 text-xs leading-relaxed text-white/50">
          {t("settings.comptes.deleteModalWarning")}{" "}
          <strong className="text-white/80">{t("settings.comptes.deleteModalIrreversible")}</strong>
        </p>

        {error && (
          <p className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={deleting}
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70 hover:bg-white/10 disabled:opacity-50"
          >
            {t("action.cancel")}
          </button>
          <button
            onClick={() => void handle()}
            disabled={deleting}
            className="rounded-xl bg-red-500/80 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {deleting ? t("settings.comptes.btnDeleting") : t("action.delete")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────── Modale édition compte ──────────────────────── */
// Édite le displayName (le handle reste lecture seule). avatarUrl existe en base mais
// n'est affiché nulle part en V2 (le portrait vient du statut session RSI) → non exposé ici.
function EditAccountModal({
  account,
  onClose,
  onSaved,
}: {
  account: Account;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [displayName, setDisplayName] = useState(account.displayName ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await invoke("update_account", {
        accountId: String(account.id),
        displayName: displayName.trim() || null,
      });
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative z-10 w-full max-w-sm rounded-2xl border p-6 backdrop-blur-2xl"
        style={{ background: "rgba(20,20,28,0.92)", borderColor: "rgba(245,158,11,0.30)" }}
      >
        <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-[var(--accent)]">
          {t("settings.comptes.editModalTitle")}
        </p>
        <p className="mb-4 text-xs text-white/50">
          {t("settings.comptes.editModalHandlePrefix")}{" "}
          <span className="font-mono text-white/80">@{account.handle}</span>{" "}
          {t("settings.comptes.editModalHandleSuffix")}
        </p>

        <label className="mb-1.5 block text-[11px] uppercase tracking-wider text-white/40">
          {t("settings.comptes.editModalDisplayName")}
        </label>
        <input
          type="text"
          value={displayName}
          autoFocus
          onChange={(e) => setDisplayName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
          }}
          placeholder={account.handle}
          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-amber-400/40 focus:outline-none"
        />

        {error && (
          <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70 hover:bg-white/10 disabled:opacity-50"
          >
            {t("action.cancel")}
          </button>
          <button
            onClick={() => void save()}
            disabled={saving}
            className="rounded-xl px-4 py-2 text-sm font-semibold text-[#0a0a0f] disabled:cursor-not-allowed disabled:opacity-60"
            style={{ background: "var(--accent)" }}
          >
            {saving ? t("settings.comptes.btnSaving") : t("settings.comptes.btnSave")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────── Onglet HUD ───────────────────────────── */

function HudTab() {
  const { t } = useTranslation();
  const [accentColor, setAccentColor] = useState(DEFAULT_ACCENT);
  const [animations, setAnimations] = useState(DEFAULT_ANIMATIONS === 1);
  const [hudIntensity, setHudIntensity] = useState(DEFAULT_HUD_INTENSITY);
  const [animatedStars, setAnimatedStars] = useState(true);
  // Lancement auto : état OS (login item), pas en base. null = chargement.
  const [autoLaunch, setAutoLaunch] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  // État réel du login item OS au montage.
  useEffect(() => {
    let cancelled = false;
    autostartIsEnabled()
      .then((v) => {
        if (!cancelled) setAutoLaunch(v);
      })
      .catch(() => {
        if (!cancelled) setAutoLaunch(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    invoke<AppSettings>("get_app_settings")
      .then((s) => {
        if (cancelled || !s) return;
        if (typeof s.accentColor === "string") setAccentColor(s.accentColor);
        if (typeof s.animationsEnabled === "number") setAnimations(s.animationsEnabled === 1);
        if (typeof s.hudGlowIntensity === "number") setHudIntensity(s.hudGlowIntensity);
        if (typeof s.animatedStarsBg === "number") setAnimatedStars(s.animatedStarsBg === 1);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(key: string, value: string) {
    try {
      await invoke("update_app_settings", { key, value });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function onAccentChange(value: string) {
    setAccentColor(value);
    applyAccent(value);
    void save("accentColor", value);
  }

  function onAnimationsChange(checked: boolean) {
    setAnimations(checked);
    void save("animationsEnabled", checked ? "1" : "0");
  }

  function onIntensityChange(value: number) {
    setHudIntensity(value);
    void save("hudGlowIntensity", value.toString());
  }

  function onAnimatedStarsChange(checked: boolean) {
    setAnimatedStars(checked);
    void save("animatedStarsBg", checked ? "1" : "0");
    void emit("hud:stars-changed", checked); // Layout (StarsLayer) applique en direct
  }

  // Lancement auto : agit sur le login item OS (pas la base). En cas d'échec, on
  // remet le toggle sur l'état réel de l'OS (re-lecture isEnabled).
  async function onAutoLaunchChange(checked: boolean) {
    setAutoLaunch(checked); // optimiste
    setError(null);
    try {
      if (checked) await autostartEnable();
      else await autostartDisable();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      try {
        setAutoLaunch(await autostartIsEnabled());
      } catch {
        setAutoLaunch(false);
      }
    }
  }

  function reset() {
    onAccentChange(DEFAULT_ACCENT);
    onAnimationsChange(DEFAULT_ANIMATIONS === 1);
    onIntensityChange(DEFAULT_HUD_INTENSITY);
    onAnimatedStarsChange(true);
  }

  return (
    <div>
      {error && (
        <p className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-4">
        {/* Thèmes constructeurs (presets d'accent → reteinte toute la DA) */}
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <p className="font-medium text-white">{t("settings.hud.themesTitle")}</p>
          <p className="mb-3 text-sm text-white/50">{t("settings.hud.themesDesc")}</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {MANUFACTURER_THEMES.map((theme) => {
              const active = accentColor.toLowerCase() === theme.color.toLowerCase();
              return (
                <button
                  key={theme.id}
                  onClick={() => onAccentChange(theme.color)}
                  className={[
                    "flex items-center gap-3 rounded-xl border p-3 text-left transition-colors",
                    active
                      ? "bg-white/10"
                      : "border-white/10 bg-white/5 hover:bg-white/10",
                  ].join(" ")}
                  style={active ? { borderColor: theme.color } : undefined}
                >
                  <span
                    className="h-7 w-7 shrink-0 rounded-full"
                    style={{
                      background: theme.color,
                      boxShadow: `0 0 10px color-mix(in oklab, ${theme.color} 55%, transparent)`,
                    }}
                  />
                  <div className="min-w-0">
                    <p
                      className="truncate text-sm font-semibold"
                      style={{ color: active ? theme.color : "#fff" }}
                    >
                      {theme.name}
                    </p>
                    <p className="truncate text-xs text-white/40">{theme.flavor}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Couleur d'accent (picker libre — preset = raccourci) */}
        <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 p-4">
          <div>
            <p className="font-medium text-white">{t("settings.hud.accentTitle")}</p>
            <p className="text-sm text-white/50">{t("settings.hud.accentDesc")}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-white/60">{accentColor}</span>
            <input
              type="color"
              value={accentColor}
              onChange={(e) => onAccentChange(e.target.value)}
              className="h-9 w-12 cursor-pointer rounded-lg border border-white/10 bg-transparent"
            />
          </div>
        </div>

        {/* Animations */}
        <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 p-4">
          <div>
            <p className="font-medium text-white">{t("settings.hud.animationsTitle")}</p>
            <p className="text-sm text-white/50">{t("settings.hud.animationsDesc")}</p>
          </div>
          <button
            role="switch"
            aria-checked={animations}
            onClick={() => onAnimationsChange(!animations)}
            className={[
              "relative h-6 w-11 rounded-full transition-colors",
              animations ? "bg-[var(--accent)]" : "bg-white/15",
            ].join(" ")}
          >
            <span
              className={[
                "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all",
                animations ? "left-[22px]" : "left-0.5",
              ].join(" ")}
            />
          </button>
        </div>

        {/* Fond étoilé */}
        <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 p-4">
          <div>
            <p className="font-medium text-white">{t("settings.hud.starsTitle")}</p>
            <p className="text-sm text-white/50">{t("settings.hud.starsDesc")}</p>
          </div>
          <button
            role="switch"
            aria-checked={animatedStars}
            onClick={() => onAnimatedStarsChange(!animatedStars)}
            className={[
              "relative h-6 w-11 rounded-full transition-colors",
              animatedStars ? "bg-[var(--accent)]" : "bg-white/15",
            ].join(" ")}
          >
            <span
              className={[
                "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all",
                animatedStars ? "left-[22px]" : "left-0.5",
              ].join(" ")}
            />
          </button>
        </div>

        {/* Intensité HUD */}
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="font-medium text-white">{t("settings.hud.intensityTitle")}</p>
              <p className="text-sm text-white/50">{t("settings.hud.intensityDesc")}</p>
            </div>
            <span className="text-sm text-white/60">{hudIntensity}</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={hudIntensity}
            onChange={(e) => onIntensityChange(Number(e.target.value))}
            className="w-full accent-[var(--accent)]"
          />
        </div>

        {/* Lancement automatique (état OS, pas en base) */}
        <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 p-4">
          <div>
            <p className="font-medium text-white">{t("settings.hud.autoLaunchTitle")}</p>
            <p className="text-sm text-white/50">{t("settings.hud.autoLaunchDesc")}</p>
          </div>
          <button
            role="switch"
            aria-checked={autoLaunch ?? false}
            disabled={autoLaunch === null}
            onClick={() => void onAutoLaunchChange(!(autoLaunch ?? false))}
            className={[
              "relative h-6 w-11 rounded-full transition-colors disabled:opacity-50",
              autoLaunch ? "bg-[var(--accent)]" : "bg-white/15",
            ].join(" ")}
          >
            <span
              className={[
                "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all",
                autoLaunch ? "left-[22px]" : "left-0.5",
              ].join(" ")}
            />
          </button>
        </div>

        <button
          onClick={reset}
          className="self-start rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white/80 transition-colors hover:bg-white/10"
        >
          {t("settings.hud.resetBtn")}
        </button>
      </div>
    </div>
  );
}

/* ───────────────────────── Onglet Notifications ───────────────────────── */

function Switch({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  // Pill glass : input type=checkbox stylisé (appearance-none). Un knob via ::before
  // ne rend pas de façon fiable sur un <input> dans WebView2 → on le pose en overlay.
  return (
    <label className="relative inline-block h-5 w-10 cursor-pointer">
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={onChange}
        className="peer h-5 w-10 cursor-pointer appearance-none rounded-full bg-white/10 transition-colors checked:bg-indigo-500"
      />
      <span className="pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform peer-checked:translate-x-5" />
    </label>
  );
}

function NotifRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div>
        <p className="text-sm font-medium text-white">{label}</p>
        {description && <p className="text-xs text-white/40">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function NotificationsTab() {
  const { t } = useTranslation();
  const [notifSettings, setNotifSettings] = useState<NotifSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testShown, setTestShown] = useState(false);

  useEffect(() => {
    let cancelled = false;
    invoke<NotifSettings>("get_notification_settings")
      .then((s) => {
        if (!cancelled) setNotifSettings(s);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function updateNotif<K extends keyof NotifSettings>(key: K, value: NotifSettings[K]) {
    setNotifSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
    const serialized = typeof value === "boolean" ? (value ? "1" : "0") : String(value);
    void invoke("update_notification_setting", { key, value: serialized }).catch((err) => {
      setError(err instanceof Error ? err.message : String(err));
    });
  }

  function handleTest() {
    void invoke("send_test_notification")
      .then(() => {
        setTestShown(true);
        window.setTimeout(() => setTestShown(false), 2500);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }

  if (error) {
    return (
      <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
        {error}
      </p>
    );
  }
  if (!notifSettings) {
    return <p className="text-sm text-white/40">{t("settings.notif.loading")}</p>;
  }

  const s = notifSettings;
  const thresholds = [24, 48, 72];

  return (
    <div className="flex flex-col gap-4">
      {/* Carte 1 — Flotte & Assurance */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-white/70">
          {t("settings.notif.cardFleetInsurance")}
        </h2>

        <NotifRow
          label={t("settings.notif.thresholdLabel")}
          description={t("settings.notif.thresholdDesc")}
        >
          <div className="inline-flex gap-1 rounded-full border border-white/10 bg-white/5 p-1">
            {thresholds.map((h) => {
              const active = s.insuranceExpiryThreshold === h;
              return (
                <button
                  key={h}
                  onClick={() => updateNotif("insuranceExpiryThreshold", h)}
                  className={[
                    "rounded-full border px-3 py-1 text-sm transition-colors",
                    active
                      ? "border-indigo-500/30 bg-indigo-500/20 text-white"
                      : "border-transparent text-white/50 hover:text-white/90",
                  ].join(" ")}
                >
                  {h}h
                </button>
              );
            })}
          </div>
        </NotifRow>

        <NotifRow
          label={t("settings.notif.insuranceExpiredLabel")}
          description={t("settings.notif.insuranceExpiredDesc")}
        >
          <Switch
            checked={s.notifInsuranceExpired}
            onChange={() => updateNotif("notifInsuranceExpired", !s.notifInsuranceExpired)}
          />
        </NotifRow>
      </div>

      {/* Carte 2 — Missions & Datamining */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-white/70">
          {t("settings.notif.cardMissionsDatamining")}
        </h2>
        <NotifRow
          label={t("settings.notif.minedMissionsLabel")}
          description={t("settings.notif.minedMissionsDesc")}
        >
          <Switch
            checked={s.notifMinedMissions}
            onChange={() => updateNotif("notifMinedMissions", !s.notifMinedMissions)}
          />
        </NotifRow>
        <NotifRow
          label={t("settings.notif.newPatchLabel")}
          description={t("settings.notif.newPatchDesc")}
        >
          <Switch
            checked={s.autoPatchDetect}
            onChange={() => updateNotif("autoPatchDetect", !s.autoPatchDetect)}
          />
        </NotifRow>
      </div>

      {/* Carte 3 — Canaux de notification */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-white/70">
          {t("settings.notif.cardChannels")}
        </h2>
        <NotifRow label={t("settings.notif.inAppLabel")} description={t("settings.notif.inAppDesc")}>
          <Switch checked={s.notifInApp} onChange={() => updateNotif("notifInApp", !s.notifInApp)} />
        </NotifRow>
        <NotifRow
          label={t("settings.notif.systemLabel")}
          description={t("settings.notif.systemDesc")}
        >
          <Switch checked={s.notifSystem} onChange={() => updateNotif("notifSystem", !s.notifSystem)} />
        </NotifRow>

        <div className="mt-3 flex items-center gap-3 border-t border-white/10 pt-3">
          <button
            onClick={handleTest}
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white/80 transition-colors hover:bg-white/10"
          >
            {t("settings.notif.testBtn")}
          </button>
          {testShown && (
            <span className="text-sm text-emerald-400">{t("settings.notif.testSent")}</span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── Onglet Datamining ───────────────────────── */

function formatEta(seconds: number | null): string {
  if (seconds === null || seconds < 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function DataminingTab() {
  const { t } = useTranslation();
  const {
    status,
    install,
    validation,
    patch,
    log,
    running,
    start,
    cancel,
    pickFolder,
    resetPath,
  } = useDatamining();

  const resolved = install?.resolved ?? null;
  const canStart = !running && !!resolved;
  const pct = Math.round(status.percentOverall);

  return (
    <div className="space-y-5">
      {/* ── Chemin d'install ── */}
      <div>
        <p className="mb-2 text-xs uppercase tracking-wider text-white/40">
          {t("settings.datamining.installLabel")}
        </p>
        <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3">
          {resolved ? (
            <>
              <p className="truncate font-mono text-sm text-white/80" title={resolved}>
                {resolved}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                {install?.channel && (
                  <span className="rounded-full bg-white/10 px-2 py-0.5 font-semibold text-white/60">
                    {install.channel}
                  </span>
                )}
                <Badge ok={!!validation?.hasDataP4k} label="Data.p4k" />
                <Badge ok={!!validation?.hasGameLog} label="Game.log" />
                {install?.configured ? (
                  <span className="text-white/40">{t("settings.datamining.channelManual")}</span>
                ) : (
                  <span className="text-white/40">{t("settings.datamining.channelAuto")}</span>
                )}
              </div>
            </>
          ) : (
            <p className="text-sm text-white/50">{t("settings.datamining.noInstall")}</p>
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            onClick={() => void pickFolder()}
            disabled={running}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white/80 transition-colors hover:bg-white/10 disabled:opacity-50"
          >
            {t("settings.datamining.pickFolderBtn")}
          </button>
          {install?.configured && (
            <button
              onClick={() => void resetPath()}
              disabled={running}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white/60 transition-colors hover:bg-white/10 disabled:opacity-50"
            >
              {t("settings.datamining.resetPathBtn")}
            </button>
          )}
        </div>
      </div>

      {/* ── Patch ── */}
      {patch?.status === "patch_detected" && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-300">
          {t("settings.datamining.patchDetected", {
            version: patch.installedVersion ? ` (${patch.installedVersion})` : "",
          })}
        </div>
      )}

      {/* ── Lancer / progression ── */}
      <div>
        {!running ? (
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => void start()}
              disabled={!canStart}
              className="rounded-xl px-4 py-2 text-sm font-semibold text-[#0a0a0f] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              style={{ background: "var(--accent)" }}
            >
              {status.state === "error"
                ? t("settings.datamining.relaunchExtraction")
                : t("settings.datamining.startExtraction")}
            </button>
            {status.state === "completed" && (
              <span className="text-sm text-emerald-400">
                {t("settings.datamining.extractionDone")}
              </span>
            )}
            {status.state === "error" && status.errorMessage && (
              <span className="text-sm text-red-300">
                {t("settings.datamining.extractionError", { message: status.errorMessage })}
              </span>
            )}
            {!resolved && (
              <span className="text-sm text-white/40">
                {t("settings.datamining.installRequired")}
              </span>
            )}
          </div>
        ) : (
          <div>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="uppercase tracking-wider text-white/60">
                {phaseLabel(status.phase, t)}
              </span>
              <span className="font-mono text-[var(--accent)]">{pct}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full transition-[width] duration-700"
                style={{ width: `${pct}%`, background: "var(--accent)" }}
              />
            </div>
            <div className="mt-1.5 flex items-center justify-between text-xs text-white/50">
              <span className="truncate">{status.currentMessage}</span>
              <span className="ml-3 shrink-0">
                {t("settings.datamining.etaPrefix", { eta: formatEta(status.etaSeconds) })}
              </span>
            </div>
            <button
              onClick={() => void cancel()}
              disabled={status.state === "cancelling"}
              className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-sm text-red-300 transition-colors hover:bg-red-500/20 disabled:opacity-50"
            >
              {status.state === "cancelling"
                ? t("settings.datamining.cancelling")
                : t("settings.datamining.cancelBtn")}
            </button>
          </div>
        )}
        {status.state === "completed" && status.tempDir && (
          <p className="mt-2 truncate font-mono text-[11px] text-white/30" title={status.tempDir}>
            {t("settings.datamining.folderPrefix", { dir: status.tempDir })}
          </p>
        )}
      </div>

      {/* ── Journal ── */}
      {log.length > 0 && (
        <div>
          <p className="mb-2 text-xs uppercase tracking-wider text-white/40">
            {t("settings.datamining.journalLabel")}
          </p>
          <div className="max-h-40 overflow-auto rounded-xl border border-white/10 bg-black/30 p-3 font-mono text-[11px] leading-relaxed text-white/60">
            {log.map((line, i) => (
              <div key={i} className="truncate" title={line}>
                {line}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Badge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className="rounded-full px-2 py-0.5 font-semibold"
      style={{
        color: ok ? "#34d399" : "#f87171",
        background: ok ? "rgba(52,211,153,0.12)" : "rgba(248,113,113,0.12)",
      }}
    >
      {ok ? "✓" : "✕"} {label}
    </span>
  );
}

/* ───────────────────────── Onglet À propos ───────────────────────── */

type UpState = "idle" | "checking" | "available" | "uptodate" | "error" | "downloading" | "ready";

function AProposTab() {
  const { t } = useTranslation();
  const [version, setVersion] = useState<string | null>(null);
  const [up, setUp] = useState<UpState>("idle");
  const [upInfo, setUpInfo] = useState<{ version: string; body?: string } | null>(null);
  const [upErr, setUpErr] = useState<string | null>(null);
  const [pct, setPct] = useState(0);
  const updateRef = useRef<Update | null>(null);

  useEffect(() => {
    let cancelled = false;
    getVersion()
      .then((v) => {
        if (!cancelled) setVersion(v);
      })
      .catch(() => {
        if (!cancelled) setVersion(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Ouvre dans le navigateur externe (jamais dans la webview de l'app).
  function open(url: string) {
    void openUrl(url).catch(() => {});
  }

  async function checkUpdates() {
    setUp("checking");
    setUpErr(null);
    try {
      const u = await check();
      if (u) {
        updateRef.current = u;
        setUpInfo({ version: u.version, body: u.body });
        setUp("available");
      } else {
        setUp("uptodate");
      }
    } catch (e) {
      // 404 attendu tant qu'aucune release n'est publiée (Étape 4) → état "error", pas de crash.
      setUpErr(e instanceof Error ? e.message : String(e));
      setUp("error");
    }
  }

  async function downloadInstall() {
    const u = updateRef.current;
    if (!u) return;
    setUp("downloading");
    setPct(0);
    setUpErr(null);
    try {
      let total = 0;
      let got = 0;
      await u.downloadAndInstall((ev) => {
        if (ev.event === "Started") total = ev.data.contentLength ?? 0;
        else if (ev.event === "Progress") {
          got += ev.data.chunkLength;
          if (total > 0) setPct(Math.round((got / total) * 100));
        } else if (ev.event === "Finished") setPct(100);
      });
      setUp("ready");
    } catch (e) {
      setUpErr(e instanceof Error ? e.message : String(e));
      setUp("error");
    }
  }

  async function doRelaunch() {
    try {
      await relaunch();
    } catch (e) {
      setUpErr(e instanceof Error ? e.message : String(e));
      setUp("error");
    }
  }

  const REPO = "https://github.com/elios134/sc-fleet-manager-v2";
  const ONIVOID = "https://github.com/Onivoid";

  return (
    <div className="space-y-4">
      {/* Identité */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <p className="text-lg font-bold text-white">SCFM V2</p>
        <p className="mt-0.5 text-sm text-white/50">
          {t("settings.apropos.versionLabel")}{" "}
          <span className="font-mono text-[var(--accent)]">{version ?? "…"}</span>
        </p>
        <p className="mt-2 text-sm text-white/60">
          {t("settings.apropos.authorPrefix")}{" "}
          <span className="font-medium text-white/80">Elios</span>
        </p>
      </div>

      {/* Mises à jour */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <p className="mb-3 text-xs uppercase tracking-wider text-white/40">
          {t("settings.apropos.updatesLabel")}
        </p>

        {up !== "downloading" && up !== "ready" && (
          <button
            onClick={() => void checkUpdates()}
            disabled={up === "checking"}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white/80 transition-colors hover:bg-white/10 disabled:opacity-50"
          >
            {up === "checking"
              ? t("settings.apropos.checking")
              : t("settings.apropos.checkUpdatesBtn")}
          </button>
        )}

        {up === "uptodate" && (
          <p className="mt-3 text-sm text-emerald-400">
            {t("settings.apropos.upToDate", { version })}
          </p>
        )}

        {up === "error" && (
          <p className="mt-3 text-sm text-white/60">
            {t("settings.apropos.checkError")}
            {upErr && <span className="mt-1 block font-mono text-xs text-white/30">{upErr}</span>}
          </p>
        )}

        {up === "available" && upInfo && (
          <div className="mt-3">
            <p className="text-sm text-white">
              {t("settings.apropos.updateAvailablePrefix")}{" "}
              <span className="font-mono text-[var(--accent)]">v{upInfo.version}</span>{" "}
              {t("settings.apropos.updateAvailableSuffix")}
            </p>
            {upInfo.body && (
              <p className="mt-1 max-h-32 overflow-auto whitespace-pre-line rounded-lg border border-white/10 bg-black/30 p-2 text-xs text-white/50">
                {upInfo.body}
              </p>
            )}
            <button
              onClick={() => void downloadInstall()}
              className="mt-3 rounded-lg px-3 py-1.5 text-sm font-semibold text-[#0a0a0f]"
              style={{ background: "var(--accent)" }}
            >
              {t("settings.apropos.downloadInstallBtn")}
            </button>
          </div>
        )}

        {up === "downloading" && (
          <div className="mt-1">
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="text-white/60">{t("settings.apropos.downloading")}</span>
              <span className="font-mono text-[var(--accent)]">{pct}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full transition-[width] duration-300"
                style={{ width: `${pct}%`, background: "var(--accent)" }}
              />
            </div>
          </div>
        )}

        {up === "ready" && (
          <div className="mt-1">
            <p className="text-sm text-emerald-400">{t("settings.apropos.updateReady")}</p>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => void doRelaunch()}
                className="rounded-lg px-3 py-1.5 text-sm font-semibold text-[#0a0a0f]"
                style={{ background: "var(--accent)" }}
              >
                {t("settings.apropos.relaunchNowBtn")}
              </button>
              <button
                onClick={() => setUp("idle")}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white/70 hover:bg-white/10"
              >
                {t("settings.apropos.laterBtn")}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Liens */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <p className="mb-3 text-xs uppercase tracking-wider text-white/40">
          {t("settings.apropos.linksLabel")}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => open(REPO)}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white/80 transition-colors hover:bg-white/10"
          >
            {t("settings.apropos.githubRepoBtn")}
          </button>
        </div>
      </div>

      {/* Crédit Multitool */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <p className="mb-2 text-xs uppercase tracking-wider text-white/40">
          {t("settings.apropos.creditsLabel")}
        </p>
        <p className="text-sm leading-relaxed text-white/70">
          {t("settings.apropos.creditPrefix")}{" "}
          <button
            onClick={() => open(ONIVOID)}
            className="font-medium text-[var(--accent)] hover:underline"
          >
            Multitool
          </button>{" "}
          {t("settings.apropos.creditSuffix")}
        </p>
      </div>
    </div>
  );
}

/* ───────────────────────── Onglet Diagnostic ───────────────────────── */

function DiagnosticTab() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState<"seed" | "remove" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: "seed" | "remove") {
    setError(null);
    setNotice(null);
    setLoading(action);
    try {
      const accountId = await invoke<string | null>("get_active_account_id");
      if (!accountId) {
        setError(t("settings.diagnostic.noActiveAccount"));
        return;
      }
      if (action === "seed") {
        await invoke("seed_sample_pack", { accountId });
        setNotice(t("settings.diagnostic.seedNotice"));
      } else {
        await invoke("remove_sample_pack", { accountId });
        setNotice(t("settings.diagnostic.removeNotice"));
      }
      await emit("fleet:synced"); // rafraîchit My Fleet / Dashboard
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(null);
    }
  }

  return (
    <div>
      {error && (
        <p className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          {error}
        </p>
      )}
      {notice && (
        <p className="mb-4 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70">
          {notice}
        </p>
      )}

      <p className="mb-4 text-sm text-white/40">{t("settings.diagnostic.intro")}</p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button
          onClick={() => run("seed")}
          disabled={loading !== null}
          className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-left transition-colors hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <p className="text-sm font-semibold text-emerald-300">
            {loading === "seed"
              ? t("settings.diagnostic.creating")
              : t("settings.diagnostic.createPackBtn")}
          </p>
          <p className="mt-1 text-xs text-white/40">{t("settings.diagnostic.createPackDesc")}</p>
        </button>

        <button
          onClick={() => run("remove")}
          disabled={loading !== null}
          className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-left transition-colors hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <p className="text-sm font-semibold text-red-300">
            {loading === "remove"
              ? t("settings.diagnostic.removing")
              : t("settings.diagnostic.removePackBtn")}
          </p>
          <p className="mt-1 text-xs text-white/40">{t("settings.diagnostic.removePackDesc")}</p>
        </button>
      </div>
    </div>
  );
}
