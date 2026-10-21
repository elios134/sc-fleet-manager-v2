import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { addMonths, type InsuranceRow as Row } from "../../../lib/insurance";

/* ── Modale renouvellement ── */

type TierKey = "standard" | "lti";
const QUICK_MONTHS = [1, 3, 6, 12, 24];

export function RenewInsuranceModal({
  row,
  onClose,
  onSaved,
}: {
  row: Row;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [tier, setTier] = useState<TierKey>("standard");
  const [durationInput, setDurationInput] = useState<string>(
    row.insuranceDuration != null ? String(row.insuranceDuration) : "",
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const isLti = tier === "lti";
  const durationMonths = isLti ? null : parseInt(durationInput, 10) || null;
  const canSave = isLti || (durationMonths != null && durationMonths >= 1);

  const newExpiry = useMemo(() => {
    if (isLti || !durationMonths || durationMonths < 1) return null;
    return addMonths(new Date(), durationMonths);
  }, [isLti, durationMonths]);

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setSaveError(null);
    try {
      await invoke("renew_insurance", {
        shipId: row.shipId,
        newExpiryIso: newExpiry ? newExpiry.toISOString() : null,
        insuranceDuration: isLti ? null : durationMonths,
      });
      onSaved();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative z-10 max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border p-6 backdrop-blur-2xl"
        style={{ background: "rgba(20,20,28,0.92)", borderColor: "var(--card-border)" }}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wider text-white/40">{t("insurance.renewKicker")}</p>
            <h2 className="text-lg font-bold text-white">{row.name}</h2>
            <p className="text-sm text-white/50">{row.manufacturer}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-white/60 hover:bg-white/10"
            aria-label={t("action.close")}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Niveau de couverture */}
        <p className="mb-2 text-xs uppercase tracking-wider text-white/40">{t("insurance.coverageType")}</p>
        <div className="mb-4 grid grid-cols-2 gap-2">
          <button
            onClick={() => setTier("standard")}
            className={[
              "rounded-xl border p-3 text-left text-sm transition-colors",
              tier === "standard"
                ? "border-indigo-500/40 bg-indigo-500/15 text-white"
                : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10",
            ].join(" ")}
          >
            <p className="font-semibold">{t("insurance.tierStandard")}</p>
            <p className="mt-0.5 text-xs text-white/40">{t("insurance.tierStandardDesc")}</p>
          </button>
          <button
            onClick={() => setTier("lti")}
            className={[
              "rounded-xl border p-3 text-left text-sm transition-colors",
              tier === "lti"
                ? "border-emerald-500/40 bg-emerald-500/15 text-white"
                : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10",
            ].join(" ")}
          >
            <p className="font-semibold">{t("insurance.tierLti")}</p>
            <p className="mt-0.5 text-xs text-white/40">{t("insurance.tierLtiDesc")}</p>
          </button>
        </div>

        {/* Durée */}
        <div className={isLti ? "pointer-events-none opacity-40" : ""}>
          <p className="mb-2 text-xs uppercase tracking-wider text-white/40">{t("insurance.duration")}</p>
          <div className="mb-2 flex items-center gap-2">
            <input
              type="number"
              min={1}
              value={durationInput}
              disabled={isLti}
              onChange={(e) => setDurationInput(e.target.value)}
              placeholder="—"
              className="w-24 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-white/20 focus:outline-none"
            />
            <span className="text-sm text-white/50">{t("insurance.months")}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_MONTHS.map((m) => (
              <button
                key={m}
                disabled={isLti}
                onClick={() => setDurationInput(String(m))}
                className={[
                  "rounded-full border px-3 py-1 text-xs transition-colors",
                  !isLti && durationInput === String(m)
                    ? "border-indigo-500/40 bg-indigo-500/20 text-white"
                    : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10",
                ].join(" ")}
              >
                {t("insurance.renew.monthsChip", { n: m })}
              </button>
            ))}
          </div>
        </div>

        {/* Aperçu nouvelle expiration */}
        <div className="mt-4 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm">
          <p className="text-xs uppercase tracking-wider text-white/40">{t("insurance.newExpiry")}</p>
          <p className="mt-1 text-white/80">
            {isLti
              ? t("insurance.perpetualLifetime")
              : newExpiry
                ? newExpiry.toLocaleDateString("fr-FR", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })
                : "—"}
          </p>
        </div>

        {saveError && (
          <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {saveError}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70 hover:bg-white/10"
          >
            {t("action.cancel")}
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={!canSave || saving}
            className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "…" : t("insurance.renew.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
