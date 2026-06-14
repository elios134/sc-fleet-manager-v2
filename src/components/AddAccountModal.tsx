import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

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
      setError("Le handle doit comporter au moins 2 caractères.");
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative z-10 w-full max-w-sm rounded-2xl border p-6 backdrop-blur-2xl"
        style={{ background: "rgba(20,20,28,0.92)", borderColor: "rgba(245,158,11,0.30)" }}
      >
        <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-[var(--accent)]">
          Ajouter un compte
        </p>
        <p className="mb-4 text-xs text-white/50">
          Crée un compte local. La connexion RSI (import du hangar) reste disponible
          depuis l'écran de connexion.
        </p>

        <label className="mb-1.5 block text-[11px] uppercase tracking-wider text-white/40">
          Handle RSI <span className="text-[var(--accent)]">*</span>
        </label>
        <input
          type="text"
          value={handle}
          autoFocus
          onChange={(e) => setHandle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && handleValid) void create();
          }}
          placeholder="ex. CitizenName"
          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-amber-400/40 focus:outline-none"
        />

        <label className="mb-1.5 mt-4 block text-[11px] uppercase tracking-wider text-white/40">
          Nom affiché (optionnel)
        </label>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && handleValid) void create();
          }}
          placeholder={handle.trim() || "Par défaut : le handle"}
          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-amber-400/40 focus:outline-none"
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
            Annuler
          </button>
          <button
            onClick={() => void create()}
            disabled={saving || !handleValid}
            className="rounded-xl px-4 py-2 text-sm font-semibold text-[#0a0a0f] disabled:cursor-not-allowed disabled:opacity-60"
            style={{ background: "var(--accent)" }}
          >
            {saving ? "Création…" : "Créer"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default AddAccountModal;
