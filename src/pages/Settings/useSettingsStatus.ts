// État résumé pour le bandeau et la navigation : compte actif, fraîcheur des données,
// lecteur Game.log, version. Chaque source est chargée indépendamment (repli silencieux).
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { LAST_SYNC_META_PREFIX, STALE_AFTER_MS, type SyncSourceKey } from "./syncTypes";
import { dataFreshnessSummary, type DataSummary } from "./status";
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
  const [s, setS] = useState<SettingsStatus>({ account: null, data: null, gamelog: null, version: null });
  useEffect(() => {
    let cancelled = false;
    const patch = (part: Partial<SettingsStatus>) => !cancelled && setS((prev) => ({ ...prev, ...part }));
    void (async () => {
      const [accounts, activeId] = await Promise.all([
        safe(invoke<Account[]>("get_accounts"), []),
        safe(invoke<string | null>("get_active_account_id"), null),
      ]);
      const active = accounts.find((a) => String(a.id) === String(activeId)) ?? null;
      if (!active) return patch({ account: null });
      const session = await safe(invoke<{ hasToken: boolean }>("get_rsi_session_status", { handle: active.handle }), { hasToken: false });
      patch({ account: { handle: active.handle, sessionActive: session.hasToken } });
    })();
    void Promise.all(
      SOURCES.map(async (k) => [k, await safe(invoke<string | null>("get_app_meta", { key: LAST_SYNC_META_PREFIX + k }), null)] as const),
    ).then((entries) => patch({ data: dataFreshnessSummary(Object.fromEntries(entries), new Date(), STALE_AFTER_MS) }));
    void safe(invoke<{ enabled: boolean; pathExists: boolean }>("get_gamelog_status"), null).then((gamelog) => patch({ gamelog }));
    void safe(getVersion(), null).then((version) => patch({ version }));
    return () => {
      cancelled = true;
    };
  }, []);
  return s;
}
