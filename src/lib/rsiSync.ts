// Flux de synchronisation RSI du hangar, partagé entre les Réglages et Ma Flotte.
// UN SEUL flux : ouverture de la webview rsi-login (session persistante par compte) →
// attente d'une session valide (poll, login la 1ʳᵉ fois) → scrape hangar + concierge →
// import en base → emit("fleet:synced"). Extrait de SettingsPage.syncRsi (comportement
// identique). Le rechargement de la flotte est déclenché par l'event "fleet:synced",
// écouté par FleetPage/Dashboard — ne pas le recoder côté appelant.

import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

export type RsiSyncResult = { imported: number; adopted: number; deleted: number };

// Garde anti-double-sync : une seule webview rsi-login à la fois (Réglages OU Ma Flotte).
let syncInProgress = false;
export function isRsiSyncInProgress(): boolean {
  return syncInProgress;
}

/**
 * Lance la synchro RSI pour `handle`. `onProgress` reçoit les libellés d'étape (pour un
 * notice/spinner). Résout sur { imported, adopted, deleted } ; rejette en cas d'échec
 * (fenêtre fermée, timeout 5 min, sync déjà en cours…).
 */
export async function runRsiSync(
  handle: string,
  onProgress?: (message: string) => void,
): Promise<RsiSyncResult> {
  if (syncInProgress) {
    throw new Error("Une synchronisation RSI est déjà en cours.");
  }
  syncInProgress = true;
  const progress = (m: string) => onProgress?.(m);
  try {
    progress("Synchronisation RSI : ouverture de la fenêtre…");
    const existing = await WebviewWindow.getByLabel("rsi-login");
    if (existing) await existing.close().catch(() => {});

    const dataDir = `rsi-${handle.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
    const win = new WebviewWindow("rsi-login", {
      url: "https://robertsspaceindustries.com/en/account/pledges",
      title: "Synchronisation RSI — SC Fleet Manager",
      width: 1024,
      height: 768,
      center: true,
      dataDirectory: dataDir,
    });
    await new Promise<void>((resolve, reject) => {
      win.once("tauri://created", () => resolve());
      win.once("tauri://error", (e) => reject(e));
    });

    // Attend une session valide : silencieux si présente, sinon l'utilisateur se connecte
    // dans la fenêtre (la 1ʳᵉ fois) — ensuite la session persiste.
    progress("Synchronisation RSI : vérification de la session…");
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
            progress("Session expirée — rechargement automatique…");
            await invoke("reload_rsi_login");
          } else if (res.status === "closed") {
            clearInterval(interval);
            clearTimeout(safety);
            reject(new Error("Fenêtre fermée avant la synchronisation."));
          }
        } catch {
          /* poll non bloquant */
        }
      }, 2000);
      safety = setTimeout(() => {
        clearInterval(interval);
        reject(new Error("Connexion expirée (5 min)."));
      }, 300000);
    });

    progress("Synchronisation : récupération du hangar…");
    const result = await invoke<{ pledges: unknown[]; handle: string | null }>(
      "scrape_rsi_hangar",
    );

    // Concierge (best-effort), fenêtre encore ouverte.
    try {
      await invoke("scrape_rsi_concierge", { handle });
    } catch (e) {
      console.error("scrape concierge échoué (ignoré)", e);
    }

    const res = await invoke<RsiSyncResult>("sync_fleet_from_scrape", {
      handle,
      pledges: result.pledges,
    });

    await win.close().catch(() => {});
    await emit("fleet:synced"); // déclenche le rechargement de Fleet/Dashboard
    return res;
  } finally {
    syncInProgress = false;
  }
}
