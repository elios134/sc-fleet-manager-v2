import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { runRsiSync, openRsiLoginWindow } from "../../../lib/rsiSync";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { AddAccountModal } from "../../../components/AddAccountModal";
import { useTranslation } from "react-i18next";
import type { Account } from "../types";
import { DeleteAccountConfirmModal, EditAccountModal } from "../components/AccountModals";

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
        <p className="mb-4 whitespace-pre-line rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70">
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


export { ComptesTab };
