import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import Modal from "./ui/Modal";
import Button from "./ui/Button";

/**
 * Modale SIMPLE d'ajout de compte (handle + displayName), sans login RSI.
 * Reproduit la disposition de l'étape « créer un compte » de la V1 (CreateAccountModal),
 * en DA V2. Le login RSI reste sur la StartPage (premier compte / connexion).
 *
 * create_account auto-active le compte créé (AppMeta rsiAccount.activeId) → c'est au
 * parent de rafraîchir la liste + émettre les events dans onCreated().
 */
export function AddAccountModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => Promise<void> | void;
}) {
  const { t } = useTranslation();
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleValid = handle.trim().length >= 2;

  async function create() {
    const h = handle.trim();
    // Validation handle : non vide, ≥ 2 caractères. L'unicité est gérée côté backend
    // (contrainte UNIQUE) → l'erreur remonte et s'affiche dans la modale.
    if (h.length < 2) {
      setError(t("addAccount.handleTooShort"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // displayName vide → null : la carte affiche alors le handle (pas de sous-titre).
      await invoke("create_account", {
        handle: h,
        displayName: displayName.trim() || null,
      });
      await onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose} size="sm">
        <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-[var(--accent)]">
          {t("addAccount.title")}
        </p>
        <p className="mb-4 text-xs text-white/50">
          {t("addAccount.description")}
        </p>

        <label className="mb-1.5 block text-[11px] uppercase tracking-wider text-white/40">
          {t("addAccount.handleLabel")} <span className="text-[var(--accent)]">*</span>
        </label>
        <input
          type="text"
          value={handle}
          autoFocus
          onChange={(e) => setHandle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && handleValid) void create();
          }}
          placeholder={t("addAccount.handlePlaceholder")}
          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-accent/40 focus:outline-none"
        />

        <label className="mb-1.5 mt-4 block text-[11px] uppercase tracking-wider text-white/40">
          {t("addAccount.displayNameLabel")}
        </label>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && handleValid) void create();
          }}
          placeholder={handle.trim() || t("addAccount.displayNamePlaceholder")}
          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-accent/40 focus:outline-none"
        />

        {error && (
          <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {t("action.cancel")}
          </Button>
          <Button onClick={() => void create()} disabled={saving || !handleValid}>
            {saving ? t("addAccount.creating") : t("addAccount.create")}
          </Button>
        </div>
    </Modal>
  );
}

export default AddAccountModal;
