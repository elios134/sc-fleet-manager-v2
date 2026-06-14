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
 * Sanitisation du handle → nom de dossier de session WebView2. UNE seule définition,
 * réutilisée par tous les ouvreurs (connexion, resync, catalogue CCU) pour qu'ils
 * partagent EXACTEMENT le même dossier par compte.
 */
export function rsiDataDir(handle: string): string {
  return `rsi-${handle.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

/**
 * Ferme la fenêtre rsi-login si elle existe (best-effort). Appelée :
 *  - avant chaque (ré)ouverture (gère le « mismatch » : une fenêtre d'un autre compte
 *    est détruite avant d'en rouvrir une sur le bon dossier),
 *  - au changement de compte (anti-fuite de session — réplique destroyRsiWindow() V1).
 */
export async function closeRsiLoginWindow(): Promise<void> {
  const existing = await WebviewWindow.getByLabel("rsi-login");
  if (existing) await existing.close().catch(() => {});
}

/**
 * Ouvre (ou réouvre) la fenêtre `rsi-login` pour `handle` avec SA session.
 *
 * WebView2 ne sépare pas les sessions par `dataDirectory` (profil EBWebView partagé) :
 * on isole donc explicitement les cookies. Séquence :
 *   1. crée la fenêtre VIDE (about:blank) — rien n'est chargé tant que la session
 *      n'est pas la bonne ;
 *   2. `purge_rsi_cookies` efface la session du compte précédent (ex. principal) ;
 *   3. `inject_rsi_cookies(handle)` restaure la session de `handle` si on l'a stockée
 *      (sinon rien → page de login RSI vierge) ;
 *   4. navigue vers /account/pledges avec la bonne session.
 * (`dataDirectory` est conservé, inoffensif, mais on ne compte plus dessus.)
 * Toute fenêtre rsi-login préexistante est détruite d'abord. UN SEUL point de création.
 */
export async function openRsiLoginWindow(
  handle: string,
  title: string,
): Promise<WebviewWindow> {
  await closeRsiLoginWindow();
  const win = new WebviewWindow("rsi-login", {
    url: "about:blank",
    title,
    width: 1024,
    height: 768,
    center: true,
    dataDirectory: rsiDataDir(handle),
  });
  await new Promise<void>((resolve, reject) => {
    win.once("tauri://created", () => resolve());
    win.once("tauri://error", (e) => reject(e));
  });
  // Isolation de session par cookies (cf. doc ci-dessus) avant tout chargement RSI.
  await invoke("purge_rsi_cookies");
  await invoke("inject_rsi_cookies", { handle });
  await invoke("reload_rsi_login"); // navigue vers /account/pledges
  return win;
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
    const win = await openRsiLoginWindow(handle, "Synchronisation RSI — SC Fleet Manager");

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
    // Fix B : on impose que la session chargée soit bien celle de `handle` (sinon abort).
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
