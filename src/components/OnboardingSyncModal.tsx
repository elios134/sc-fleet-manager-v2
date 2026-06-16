// Modale d'onboarding (premier setup) : informe que l'app synchronise toutes les
// données et montre la progression étape par étape. FERMABLE à tout moment (Échap /
// ✕ / clic dehors) — la fermeture n'arrête PAS la synchronisation, qui continue en
// arrière-plan et reste suivie via la pastille de la topbar.
//
// À la fin : récap des étapes échouées/ignorées (relançables dans les Réglages) +
// message final invitant à re-cocher les blueprints (seule action manuelle).

import { Check, X, Minus, Loader2, Circle } from "lucide-react";
import { useTranslation } from "react-i18next";
import Modal from "./ui/Modal";
import type { OnboardingStep, StepStatus } from "../lib/onboarding";

function StatusIcon({ status }: { status: StepStatus }) {
  switch (status) {
    case "ok":
      return <Check className="h-4 w-4 text-[#34d399]" />;
    case "failed":
      return <X className="h-4 w-4 text-[#f87171]" />;
    case "skipped":
      return <Minus className="h-4 w-4 text-white/40" />;
    case "running":
      return <Loader2 className="h-4 w-4 animate-spin text-[#fbbf24]" />;
    default:
      return <Circle className="h-2.5 w-2.5 text-white/20" />;
  }
}

export default function OnboardingSyncModal({
  steps,
  done,
  blueprintsRunning,
  onClose,
}: {
  steps: OnboardingStep[];
  done: boolean;
  blueprintsRunning: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  const failed = steps.filter((s) => s.status === "failed" || s.status === "skipped");

  // Message : avant la fin → intro ; à la fin → message exact si blueprints fini,
  // sinon message « plans en arrière-plan » (re-cochage possible une fois chargé).
  const message = done
    ? blueprintsRunning
      ? t("onboarding.done.messageBackground")
      : t("onboarding.done.message")
    : t("onboarding.intro");

  return (
    <Modal title={t("onboarding.title")} onClose={onClose} size="md">
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-white/70">{message}</p>

        {/* Liste des étapes (statut live). */}
        <ul className="space-y-1.5">
          {steps.map((s) => (
            <li
              key={s.key}
              className="flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2"
            >
              <span
                className={`text-[13px] ${
                  s.status === "skipped" ? "text-white/40" : "text-white/80"
                }`}
              >
                {t(`onboarding.step.${s.key}`)}
              </span>
              <span className="flex h-5 w-5 items-center justify-center">
                <StatusIcon status={s.status} />
              </span>
            </li>
          ))}
        </ul>

        {/* Récap des échecs/ignorés, seulement à la fin et s'il y en a. */}
        {done && failed.length > 0 && (
          <div className="rounded-lg border border-[#fbbf24]/25 bg-[#fbbf24]/[0.06] px-3 py-2.5">
            <p className="text-[12px] font-semibold text-[#fbbf24]">
              {t("onboarding.done.failuresIntro")}
            </p>
            <ul className="mt-1.5 space-y-0.5">
              {failed.map((s) => (
                <li key={s.key} className="text-[12px] text-white/60">
                  • {t(`onboarding.step.${s.key}`)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Pied : bouton de fermeture. Pendant la sync → « fermer (continue en arrière-plan) ». */}
      <div className="mt-5 flex justify-end">
        <button
          onClick={onClose}
          className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/10"
        >
          {done ? t("onboarding.close") : t("onboarding.closeRunning")}
        </button>
      </div>
    </Modal>
  );
}
