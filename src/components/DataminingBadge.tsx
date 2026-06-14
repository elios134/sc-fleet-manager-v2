// Pastille Datamining dans la topbar (réplique DataminingBadge V1, DA V2 ambre).
// États : détecté / activé / running (phase + %) / completed / error.
// Clic → ouvre les Réglages (où vit la section Datamining). Cachée si SC non détecté.

import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Database, Loader2 } from "lucide-react";
import { useDatamining, phaseLabel } from "../contexts/DataminingContext";

const COMPLETED_HIDE_MS = 5000;

export function DataminingBadge() {
  const navigate = useNavigate();
  const { status, install, consent } = useDatamining();
  const [showCompleted, setShowCompleted] = useState(false);

  useEffect(() => {
    if (status.state === "completed") {
      setShowCompleted(true);
      const t = setTimeout(() => setShowCompleted(false), COMPLETED_HIDE_MS);
      return () => clearTimeout(t);
    }
    setShowCompleted(false);
  }, [status.state]);

  // SC non détecté → pas de pastille (comme V1).
  if (!install?.resolved) return null;

  const running = status.state === "running" || status.state === "cancelling";
  const isError = status.state === "error";
  const isCompleted = showCompleted;

  let tone: string;
  let label: string;
  if (running) {
    tone = "#fbbf24";
    label = `Datamining · ${Math.round(status.percentOverall)}%`;
  } else if (isCompleted) {
    tone = "#34d399";
    label = "Datamining · terminé";
  } else if (isError) {
    tone = "#f87171";
    label = "Datamining · erreur";
  } else if (consent === "granted") {
    tone = "#34d399";
    label = "Datamining";
  } else {
    tone = "rgba(255,255,255,0.6)";
    label = "Datamining détecté";
  }

  const title = running
    ? `${phaseLabel(status.phase)} — ${status.currentMessage}`
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
