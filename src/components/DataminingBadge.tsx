// Pastille Datamining dans la topbar (réplique DataminingBadge V1, DA V2 ambre).
// États : détecté / activé / running (phase + %) / completed / error.
// Clic → ouvre les Réglages (où vit la section Datamining). Cachée si SC non détecté.

import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Database, Loader2 } from "lucide-react";
import { useDatamining, phaseLabel } from "../contexts/DataminingContext";

const COMPLETED_HIDE_MS = 5000;

export function DataminingBadge() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { status, install, consent, onboarding, setOnboardingModalOpen } = useDatamining();
  const [showCompleted, setShowCompleted] = useState(false);

  useEffect(() => {
    if (status.state === "completed") {
      setShowCompleted(true);
      const t = setTimeout(() => setShowCompleted(false), COMPLETED_HIDE_MS);
      return () => clearTimeout(t);
    }
    setShowCompleted(false);
  }, [status.state]);

  // Mode « progression onboarding » (premier setup) : prioritaire et affiché MÊME
  // si SC non détecté, car c'est le seul indicateur de la sync auto en cours.
  // Disparaît quand l'orchestration masque la progression (setProgress(null) en fin).
  if (onboarding?.active) {
    const tone = "#fbbf24";
    return (
      <button
        type="button"
        onClick={() => setOnboardingModalOpen(true)}
        title={t("onboarding.badge.reopen")}
        aria-label={t("onboarding.badge.reopen")}
        className="flex h-7 cursor-pointer items-center gap-2 rounded-full border px-3 text-[11px] font-semibold uppercase tracking-wider transition-opacity hover:opacity-80"
        style={{
          color: tone,
          borderColor: `color-mix(in oklab, ${tone} 40%, rgba(255,255,255,0.1))`,
          background: `color-mix(in oklab, ${tone} 12%, transparent)`,
        }}
      >
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {onboarding.label}
      </button>
    );
  }

  // SC non détecté → pas de pastille (comme V1).
  if (!install?.resolved) return null;

  const running = status.state === "running" || status.state === "cancelling";
  const isError = status.state === "error";
  const isCompleted = showCompleted;

  let tone: string;
  let label: string;
  if (running) {
    tone = "#fbbf24";
    label = t("datamining.badge.running", { percent: Math.round(status.percentOverall) });
  } else if (isCompleted) {
    tone = "#34d399";
    label = t("datamining.badge.completed");
  } else if (isError) {
    tone = "#f87171";
    label = t("datamining.badge.error");
  } else if (consent === "granted") {
    tone = "#34d399";
    label = t("datamining.badge.label");
  } else {
    tone = "rgba(255,255,255,0.6)";
    label = t("datamining.badge.detectedLabel");
  }

  const title = running
    ? `${phaseLabel(status.phase, t)} — ${status.currentMessage}`
    : (install.resolved ?? "");

  return (
    <button
      type="button"
      onClick={() => navigate("/settings")}
      title={title}
      className="flex h-7 items-center gap-2 rounded-full border px-3 text-[11px] font-semibold uppercase tracking-wider transition-opacity hover:opacity-80"
      style={{
        color: tone,
        borderColor: `color-mix(in oklab, ${tone} 40%, rgba(255,255,255,0.1))`,
        background: `color-mix(in oklab, ${tone} 12%, transparent)`,
      }}
    >
      {running ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Database className="h-3.5 w-3.5" />
      )}
      {label}
    </button>
  );
}

export default DataminingBadge;
