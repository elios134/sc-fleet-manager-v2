// État résumé pour le bandeau et la navigation : compte actif, fraîcheur des données,
// lecteur Game.log, version. Chaque source est chargée indépendamment (repli silencieux).
import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { LAST_SYNC_META_PREFIX, STALE_AFTER_MS, type SyncSourceKey } from "./syncTypes";
import { dataFreshnessSummary, mergeLastSync, type DataSummary } from "./status";
import { useDonneesSyncState } from "./hooks/useDonneesSync";
import type { Account } from "./types";

export type SettingsStatus = {
  account: { handle: string; sessionActive: boolean } | null;
  data: DataSummary | null;
  gamelog: { enabled: boolean; pathExists: boolean } | null;
  version: string | null;
};

const SOURCES: SyncSourceKey[] = ["wiki", "cargo", "uex"];
const safe = <T,>(p: Promise<T>, fallback: T): Promise<T> => p.catch(() => fallback);

export function useSettingsStatus(): SettingsStatus {
  const [s, setS] = useState<Omit<SettingsStatus, "data">>({ account: null, gamelog: null, version: null });
  const [fetched, setFetched] = useState<Record<string, string | null> | null>(null);
  const store = useDonneesSyncState();
  const patch = useCallback((part: Partial<SettingsStatus>) => setS((prev) => ({ ...prev, ...part })), []);

  // Compte actif + session : relu à chaque connexion / déconnexion / changement de compte.
  const loadAccount = useCallback(async () => {
    const [accounts, activeId] = await Promise.all([
      safe(invoke<Account[]>("get_accounts"), []),
      safe(invoke<string | null>("get_active_account_id"), null),
    ]);
    const active = accounts.find((a) => String(a.id) === String(activeId)) ?? null;
    if (!active) return patch({ account: null });
    const session = await safe(invoke<{ hasToken: boolean }>("get_rsi_session_status", { handle: active.handle }), { hasToken: false });
    patch({ account: { handle: active.handle, sessionActive: session.hasToken } });
  }, [patch]);
  const loadGamelog = useCallback(
    () => void safe(invoke<{ enabled: boolean; pathExists: boolean }>("get_gamelog_status"), null).then((gamelog) => patch({ gamelog })),
    [patch],
  );

  useEffect(() => {
    void loadAccount();
    loadGamelog();
    void Promise.all(
      SOURCES.map(async (k) => [k, await safe(invoke<string | null>("get_app_meta", { key: LAST_SYNC_META_PREFIX + k }), null)] as const),
    ).then((entries) => setFetched(Object.fromEntries(entries)));
    void safe(getVersion(), null).then((version) => patch({ version }));
    const uns = [
      ...["rsi:login-success", "rsi:logout", "account:updated", "account:switched"].map((ev) => listen(ev, () => void loadAccount())),
      listen("gamelog:changed", () => loadGamelog()),
    ];
    return () => uns.forEach((u) => void u.then((f) => f()));
  }, [loadAccount, loadGamelog, patch]);

  // Fraîcheur des données : dates du store (mises à jour par chaque synchro) sinon base.
  const data = fetched ? dataFreshnessSummary(mergeLastSync(store.lastSync, fetched), new Date(), STALE_AFTER_MS) : null;
  return { ...s, data };
}
