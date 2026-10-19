import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { runRsiSync, openRsiLoginWindow } from "../../../lib/rsiSync";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { AddAccountModal } from "../../../components/AddAccountModal";
import { useTranslation } from "react-i18next";
import type { Account } from "../types";
import { DeleteAccountConfirmModal, EditAccountModal } from "../components/AccountModals";
import { AccountCard } from "../components/AccountCard";
import { SettingRow, SettingsCard } from "../components/SettingRow";
import { Segmented } from "../components/Segmented";
import { setLanguage } from "../../../i18n/language";
import { SUPPORTED_LANGS, type Lang } from "../../../i18n";

type RsiSessionStatus = {
  hasToken: boolean;
  portraitUrl: string | null;
  conciergeLevel: string | null;
  conciergeProgress: number | null;
};

/* Panneau Compte : comptes RSI (connexion, synchro, activation, modales) + langue. */
export function AccountPanel() {
  const { t, i18n } = useTranslation();
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
      await emit("account:updated"); // barre du haut + bandeau d'état se recalent
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
    <>
      <SettingsCard
        title={t("settings.comptes.sectionTitle")}
        hint={t("settings.comptes.sectionSubtitle")}
        action={
          <button type="button" onClick={() => setAddOpen(true)} className="rounded-[10px] border border-white/15 bg-white/5 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-white/10">
            {t("settings.comptes.addAccountBtn")}
          </button>
        }
      >
        {error && <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">{error}</p>}
        {notice && <p className="whitespace-pre-line rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70">{notice}</p>}
        {accounts.map((acc) => {
          const session = sessions[acc.handle];
          return (
            <AccountCard
              key={acc.id}
              account={acc}
              active={String(acc.id) === activeId}
              hasToken={session?.hasToken ?? false}
              portraitUrl={session?.portraitUrl ?? null}
              conciergeLevel={session?.conciergeLevel ?? null}
              syncing={syncing}
              onSync={() => void syncRsi(acc.handle)}
              onDisconnect={() => void disconnectRsi(acc.handle)}
              onConnect={() => void connectRsi(acc.handle)}
              onActivate={() => void activate(acc.id)}
              onEdit={() => setEditTarget(acc)}
              onDelete={() => setDeleteTarget(acc)}
            />
          );
        })}
        {accounts.length === 0 && <p className="text-sm text-white/50">{t("settings.comptes.noneRegistered")}</p>}
      </SettingsCard>

      <SettingsCard title={t("settings.langue.sectionTitle")}>
        <SettingRow title={t("settings.langue.rowTitle")} description={t("settings.langue.rowDesc")}>
          <Segmented
            label={t("settings.langue.sectionTitle")}
            value={(SUPPORTED_LANGS as readonly string[]).includes(i18n.language) ? (i18n.language as Lang) : "fr"}
            onChange={(l) => void setLanguage(l)}
            options={[
              { value: "fr", label: t("settings.langue.optionFr") },
              { value: "en", label: t("settings.langue.optionEn") },
            ]}
          />
        </SettingRow>
      </SettingsCard>

      {deleteTarget && <DeleteAccountConfirmModal account={deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={confirmDelete} />}

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
    </>
  );
}
