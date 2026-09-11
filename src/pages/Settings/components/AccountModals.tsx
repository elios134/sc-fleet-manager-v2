import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import type { Account } from "../types";

/* ──────────────────────── Modale suppression compte ──────────────────────── */
export function DeleteAccountConfirmModal({
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
export function EditAccountModal({
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
        style={{ background: "rgba(20,20,28,0.92)", borderColor: "color-mix(in oklab, var(--accent) 30%, transparent)" }}
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
          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-accent/40 focus:outline-none"
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
