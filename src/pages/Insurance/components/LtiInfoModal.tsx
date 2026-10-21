import { X } from "lucide-react";
import { useTranslation } from "react-i18next";


export function LtiInfoModal({
  shipName,
  manufacturer,
  onClose,
}: {
  shipName: string;
  manufacturer: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative z-10 w-full max-w-sm rounded-2xl border p-6 backdrop-blur-2xl"
        style={{ background: "rgba(20,20,28,0.92)", borderColor: "var(--card-border)" }}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wider text-white/40">{t("insurance.ltiModalKicker")}</p>
            <h2 className="text-lg font-bold text-white">{shipName}</h2>
            <p className="text-sm text-white/50">{manufacturer}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-white/60 hover:bg-white/10"
            aria-label={t("action.close")}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mb-3 flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
          <span className="text-2xl text-emerald-400">∞</span>
          <div>
            <p className="text-sm font-semibold text-emerald-300">{t("insurance.perpetualCoverage")}</p>
            <p className="text-xs text-white/50">{t("insurance.noRenewalNeeded")}</p>
          </div>
        </div>
        <p className="text-sm text-white/60">
          {t("insurance.ltiModalDesc")}
        </p>

        <div className="mt-5 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70 hover:bg-white/10"
          >
            {t("action.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
