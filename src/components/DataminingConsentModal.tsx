// Modale de consentement Datamining (réplique DataminingConsentModal V1, DA V2).
// Rôle : (1) prévenir que le datamining s'effectue LOCALEMENT sur la machine de
// l'utilisateur et obtenir son consentement, (2) l'informer si un nouveau patch SC
// est détecté (get_patch_status). S'affiche si SC détecté + pas encore de consentement.

import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useDatamining } from "../contexts/DataminingContext";
import Button from "./ui/Button";

export function DataminingConsentModal() {
  const { t } = useTranslation();
  const { install, patch, consent, setConsent, start } = useDatamining();
  const [dismissed, setDismissed] = useState(false);

  // Conditions d'affichage : SC détecté + pas de décision enregistrée + pas reporté.
  if (consent !== null || dismissed || !install?.resolved) return null;

  const patchDetected = patch?.status === "patch_detected";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/70" />
      <div
        className="relative z-10 w-full max-w-lg rounded-2xl border p-6 backdrop-blur-2xl"
        style={{ background: "rgba(20,20,28,0.94)", borderColor: "color-mix(in oklab, var(--accent) 30%, transparent)" }}
      >
        <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-[var(--accent)]">
          {t("datamining.consent.scTitle")}
        </p>
        <p className="mb-4 text-sm leading-relaxed text-white/70">
          <Trans
            i18nKey="datamining.consent.localDescription"
            components={[<strong key="0" />, <span key="1" className="font-mono" />]}
          />
        </p>

        {/* Chemin / canal détecté (lecture seule) */}
        <div className="mb-3 rounded-lg border border-white/10 bg-black/30 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wider text-white/40">
            {t("datamining.consent.installDetected")}{install.channel ? ` · ${install.channel}` : ""}
          </p>
          <p className="truncate font-mono text-xs text-white/70" title={install.resolved}>
            {install.resolved}
          </p>
        </div>

        {/* Info patch */}
        {patchDetected && (
          <div className="mb-4 rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-xs text-accent">
            {t("datamining.consent.patchDetectedPrefix")}
            {patch?.installedVersion ? ` (${patch.installedVersion})` : ""} —{" "}
            {t("datamining.consent.patchDetectedSuffix")}
          </div>
        )}

        <div className="mt-5 flex items-center justify-between gap-2">
          <button
            onClick={() => setConsent("never")}
            className="rounded-xl px-3 py-2 text-xs text-white/40 hover:text-white/70"
          >
            {t("datamining.consent.neverAsk")}
          </button>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setDismissed(true)}>
              {t("datamining.consent.later")}
            </Button>
            <Button
              onClick={() => {
                setConsent("granted");
                void start();
              }}
            >
              {t("datamining.consent.activateAndStart")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default DataminingConsentModal;
