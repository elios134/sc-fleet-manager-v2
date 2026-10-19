import { useTranslation } from "react-i18next";
import type { Account } from "../types";

const btn = "rounded-[10px] border px-3 py-1.5 text-[12.5px] font-semibold whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50";
const neutral = `${btn} border-white/15 bg-white/5 text-white hover:bg-white/10`;

/** Carte d'un compte RSI : portrait ou initiales, badges, méta, actions. Présentation seule. */
export function AccountCard({
  account,
  active,
  hasToken,
  portraitUrl,
  conciergeLevel,
  syncing,
  onSync,
  onDisconnect,
  onConnect,
  onActivate,
  onEdit,
  onDelete,
}: {
  account: Account;
  active: boolean;
  hasToken: boolean;
  portraitUrl: string | null;
  conciergeLevel: string | null;
  syncing: boolean;
  onSync: () => void;
  onDisconnect: () => void;
  onConnect: () => void;
  onActivate: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const initials = account.handle.slice(0, 2).toUpperCase();
  return (
    <div
      className={`grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3.5 rounded-[14px] border p-3.5 sm:grid-cols-[auto_minmax(0,1fr)_auto] ${
        active ? "border-[var(--accent)]/45 bg-[linear-gradient(135deg,var(--accent-muted),transparent_70%)]" : "border-white/10 bg-white/[0.03]"
      }`}
    >
      {hasToken && portraitUrl ? (
        <img src={portraitUrl} alt="" className="h-11 w-11 rounded-xl object-cover" />
      ) : (
        <span className={`grid h-11 w-11 place-items-center rounded-xl font-extrabold text-white ${active ? "bg-[var(--accent)]" : "bg-white/15"}`}>{initials}</span>
      )}
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2">
          <b className="truncate text-[15px] text-white">{account.handle}</b>
          {hasToken ? (
            <span className="rounded-full border border-emerald-400/35 bg-emerald-400/15 px-2 text-[10.5px] font-bold text-emerald-300">{t("settings.comptes.badgeSessionActive")}</span>
          ) : (
            <span className="rounded-full border border-white/15 px-2 text-[10.5px] font-bold text-white/50">{t("settings.comptes.badgeNotConnected")}</span>
          )}
          {active && (
            <span className="rounded-full border border-[var(--accent)]/50 bg-[var(--accent-muted)] px-2 text-[10.5px] font-bold text-white">{t("settings.comptes.badgeActive")}</span>
          )}
        </p>
        <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-white/50">
          {account.displayName && <span>{account.displayName}</span>}
          {conciergeLevel && <span>{t("settings.comptes.conciergePrefix", { level: conciergeLevel })}</span>}
        </p>
      </div>
      <div className="col-span-2 flex flex-wrap gap-1.5 sm:col-span-1 sm:justify-end">
        {hasToken ? (
          <>
            <button type="button" onClick={onSync} disabled={syncing} className={`${btn} border-transparent bg-[var(--accent)] text-white`}>
              {syncing ? t("settings.comptes.btnSyncing") : t("settings.comptes.btnSyncRsi")}
            </button>
            <button type="button" onClick={onDisconnect} className={`${btn} border-transparent text-white/55 hover:text-white`}>{t("settings.comptes.btnDisconnect")}</button>
          </>
        ) : (
          <button type="button" onClick={onConnect} className={neutral}>{t("settings.comptes.btnConnectRsi")}</button>
        )}
        {!active && <button type="button" onClick={onActivate} className={neutral}>{t("settings.comptes.btnActivateAccount")}</button>}
        <button type="button" onClick={onEdit} className={neutral}>{t("settings.comptes.btnModify")}</button>
        <button type="button" onClick={onDelete} className={`${btn} border-red-400/35 text-red-300 hover:bg-red-400/10`}>{t("settings.comptes.btnDeleteAccount")}</button>
      </div>
    </div>
  );
}
