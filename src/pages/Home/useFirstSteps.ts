// État des « Premiers pas » de l'accueil : complète les données de l'accueil (compte, prix UEX,
// Game.log) par la synchro Wiki et la carte, lance les synchros directes (prix, carte) et
// mémorise le masquage de la carte.
import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { firstSteps, type FirstStepKey } from "../../lib/firstSteps";
import { LAST_SYNC_META_PREFIX } from "../../lib/syncMeta";
import { ONBOARDING_FLAG } from "../../lib/onboarding";
import type { HomeData } from "./useHomeData";

const DISMISS_KEY = "ui.firstStepsDismissed";
// Synchros lancées depuis l'accueil (les autres étapes ouvrent le bon réglage).
const DIRECT: Partial<Record<FirstStepKey, string>> = { uex: "sync_uex_prices", starmap: "sync_starmap" };

export function useFirstSteps(d: HomeData, onReload: () => void) {
  const [wikiSynced, setWikiSynced] = useState(false);
  const [starmapReady, setStarmapReady] = useState(false);
  const [dismissed, setDismissed] = useState(true); // masqué tant que l'état n'est pas lu
  const [running, setRunning] = useState<FirstStepKey | null>(null);

  const check = useCallback(async () => {
    const [wiki, onboarded, bodies, dismiss] = await Promise.all([
      invoke<string | null>("get_app_meta", { key: LAST_SYNC_META_PREFIX + "wiki" }).catch(() => null),
      invoke<string | null>("get_app_meta", { key: ONBOARDING_FLAG }).catch(() => null),
      invoke<unknown[]>("get_starmap_bodies").catch(() => []),
      invoke<string | null>("get_app_meta", { key: DISMISS_KEY }).catch(() => null),
    ]);
    setWikiSynced(wiki != null || onboarded != null);
    setStarmapReady(bodies.length > 0);
    setDismissed(dismiss === "1");
  }, []);
  useEffect(() => void check(), [check]);

  const state = firstSteps({
    hasAccount: d.handle != null,
    wikiSynced,
    uexSynced: d.uexAgeHours != null,
    starmapReady,
    gamelogFound: d.gamelog?.pathExists ?? false,
  });

  /** Lance la synchro directe de l'étape ; renvoie false si l'étape s'ouvre dans les réglages. */
  const run = (key: FirstStepKey): boolean => {
    const cmd = DIRECT[key];
    if (!cmd) return false;
    setRunning(key);
    void invoke(cmd)
      // Même date de dernière synchro que Réglages › Données (source « uex »).
      .then(() => key === "uex" && invoke("set_app_meta", { key: LAST_SYNC_META_PREFIX + "uex", value: new Date().toISOString() }))
      .catch(() => {})
      .finally(() => {
        setRunning(null);
        void check();
        onReload();
      });
    return true;
  };
  const dismiss = () => {
    setDismissed(true);
    void invoke("set_app_meta", { key: DISMISS_KEY, value: "1" }).catch(() => {});
  };
  return { ...state, dismissed, running, run, dismiss };
}
