// Pastille « Synchro auto · Prix UEX » pendant la synchro automatique du lancement ; clic → Réglages › Données.
// Lance aussi la synchro (une fois par session) ; à la fin, le statut du patch est relu.
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { useGame } from "../contexts/GameContext";
import { useAutoSync, useAutoSyncState } from "../hooks/useAutoSync";
import { SyncPill } from "./SyncPill";

export function AutoSyncBadge() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { refresh } = useGame();
  useAutoSync(() => void refresh());
  const { label } = useAutoSyncState();
  if (!label) return null;
  return <SyncPill label={label} title={t("autoSync.badgeTitle")} onClick={() => navigate("/settings#donnees")} />;
}
