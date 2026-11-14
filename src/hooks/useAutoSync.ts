// Synchro automatique au lancement (spec docs/specs/2026-11-14-synchro-auto.md) : prix UEX à chaque
// lancement, wiki + cargo à chaque nouvelle mise à jour de Star Citizen. Tourne une fois par session,
// après le premier lancement. Petit store module (pastille, interrupteur) lu par la barre du haut,
// Réglages › Données et l'Accueil.
import { useEffect, useRef, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  AUTO_SYNC_CHANGENUM_PREFIX,
  AUTO_SYNC_ENABLED_KEY,
  AUTO_SYNC_LAST_KEY,
  isAutoSyncEnabled,
  planAutoSync,
  type AutoSyncSource,
  type PatchStatusKind,
} from "../lib/autoSync";
import { ONBOARDING_FLAG } from "../lib/onboarding";
import { LAST_SYNC_META_PREFIX } from "../lib/syncMeta";
import { runSourceGroup } from "../pages/Settings/lib/syncGroups";

export interface AutoSyncLast {
  version: string | null;
  at: string;
}
interface AutoSyncState {
  enabled: boolean;
  /** Texte de la pastille ; null = aucune synchro auto en cours. */
  label: string | null;
  last: AutoSyncLast | null;
}

let state: AutoSyncState = { enabled: true, label: null, last: null };
const subs = new Set<() => void>();
function patchState(p: Partial<AutoSyncState>) {
  state = { ...state, ...p };
  subs.forEach((s) => s());
}

export function useAutoSyncState(): AutoSyncState {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => state,
  );
}

/** Interrupteur de Réglages › Données (persisté en AppMeta). */
export async function setAutoSyncEnabled(on: boolean) {
  patchState({ enabled: on });
  await invoke("set_app_meta", { key: AUTO_SYNC_ENABLED_KEY, value: on ? "1" : "0" }).catch(() => {});
}

const meta = (key: string) => invoke<string | null>("get_app_meta", { key }).catch(() => null);
const setMeta = (key: string, value: string) => invoke("set_app_meta", { key, value }).catch(() => {});
const toNum = (v: string | null) => (v != null && /^\d+$/.test(v.trim()) ? Number(v) : null);

function parseLast(raw: string | null): AutoSyncLast | null {
  try {
    const v = raw ? (JSON.parse(raw) as Partial<AutoSyncLast>) : null;
    return v?.at ? { version: v.version ?? null, at: v.at } : null;
  } catch {
    return null;
  }
}

interface PatchInfo {
  status: PatchStatusKind;
  installedVersion: string | null;
  installedChangenum: number | null;
}

async function runAutoSync(t: () => TFunction) {
  const [enabledRaw, lastRaw, onboarded, everSynced] = await Promise.all([
    meta(AUTO_SYNC_ENABLED_KEY),
    meta(AUTO_SYNC_LAST_KEY),
    meta(ONBOARDING_FLAG),
    meta(LAST_SYNC_META_PREFIX + "uex"),
  ]);
  patchState({ enabled: isAutoSyncEnabled(enabledRaw), last: parseLast(lastRaw) });
  // Installation neuve : l'onboarding du premier lancement synchronise déjà tout.
  if (!state.enabled || (onboarded !== "1" && !everSynced)) return;

  const patch = await invoke<PatchInfo>("get_patch_status").catch(() => null);
  const installed = patch?.installedChangenum ?? null;
  const [wikiDone, cargoDone] = await Promise.all([meta(AUTO_SYNC_CHANGENUM_PREFIX + "wiki"), meta(AUTO_SYNC_CHANGENUM_PREFIX + "cargo")]);
  const plan = planAutoSync({
    installedChangenum: installed,
    patchStatus: patch?.status ?? "unknown",
    done: { wiki: toNum(wikiDone), cargo: toNum(cargoDone) },
  });
  for (const s of plan.seed) await setMeta(AUTO_SYNC_CHANGENUM_PREFIX + s, String(installed));

  const label = (s: AutoSyncSource) => t()("autoSync.badge", { source: t()(`autoSync.source.${s}`) });
  let current: AutoSyncSource | null = null;
  const unlisten = await listen<{ phase?: string; current?: number; total?: number }>("wiki:sync-progress", (e) => {
    const p = e.payload ?? {};
    if (current !== "wiki" || p.phase !== "blueprint-details" || !p.total) return;
    patchState({ label: t()("onboarding.badge.blueprints", { current: p.current ?? 0, total: p.total }) });
  });

  const failed: AutoSyncSource[] = [];
  try {
    for (const s of plan.sources) {
      current = s;
      patchState({ label: label(s) });
      const ko = await runSourceGroup(s);
      if (ko.length > 0) failed.push(s);
      else if (s !== "uex" && installed != null) await setMeta(AUTO_SYNC_CHANGENUM_PREFIX + s, String(installed));
    }
  } finally {
    unlisten();
    patchState({ label: null });
  }
  if (!plan.patch) return;

  const version = patch?.installedVersion ?? null;
  if (failed.length === 0) {
    const last = { version, at: new Date().toISOString() };
    patchState({ last });
    await setMeta(AUTO_SYNC_LAST_KEY, JSON.stringify(last));
  }
  const title = failed.length === 0 ? t()("autoSync.notif.okTitle", { version: version ?? "—" }) : t()("autoSync.notif.partialTitle");
  const body =
    failed.length === 0
      ? t()("autoSync.notif.okBody", { list: plan.sources.map((s) => t()(`autoSync.source.${s}`)).join(", ") })
      : t()("autoSync.notif.partialBody", { list: failed.map((s) => t()(`autoSync.source.${s}`)).join(", ") });
  await invoke("notify_data_sync", { title, body }).catch(() => {});
}

/** Lance la synchro auto une fois par session ; `onDone` rafraîchit le statut du patch. */
export function useAutoSync(onDone: () => void) {
  const { t } = useTranslation();
  const tRef = useRef(t);
  tRef.current = t;
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void runAutoSync(() => tRef.current).finally(() => doneRef.current());
  }, []);
}
