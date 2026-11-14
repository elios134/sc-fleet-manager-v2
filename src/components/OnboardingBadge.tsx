// Pastille du premier lancement dans la barre du haut : progression de la synchro automatique
// (« Synchronisation 3/12 », puis « Plans 342/1559 » pendant les plans en fond). Clic = rouvre
// la modale du détail. Masquée dès que l'onboarding ne tourne plus.

import { useTranslation } from "react-i18next";
import { useGame } from "../contexts/GameContext";
import { SyncPill } from "./SyncPill";

export function OnboardingBadge() {
  const { t } = useTranslation();
  const { onboarding, setOnboardingModalOpen } = useGame();
  if (!onboarding?.active) return null;
  return <SyncPill label={onboarding.label} title={t("onboarding.badge.reopen")} onClick={() => setOnboardingModalOpen(true)} />;
}
