import { useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Box, Footprints, ShieldCheck, Trash2 } from "lucide-react";
import ShipDetailsModal from "../../../components/ShipDetailsModal";
import { hubTabPath } from "../../../app/navHubs";
import type { ShipRow } from "../types";

const RENTAL_EXTEND_OPTIONS = [1, 3, 7, 30];
const action = "inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white/80 transition-colors hover:bg-white/10";

/** Fenêtre de détail d'un vaisseau de la flotte : fiche partagée + intérieur visitable, Vue 3D, Assurances, location
 *  (prolonger) et suppression confirmée (vaisseaux ajoutés à la main seulement). */
export function FleetShipModal({
  ship,
  visitable,
  onClose,
  onDelete,
  onExtend,
}: {
  ship: ShipRow;
  /** Intérieur visitable à pied (modèle 3D publié dans asset-3D). */
  visitable: boolean;
  onClose: () => void;
  onDelete?: () => void;
  onExtend?: (days: number) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  return (
    <ShipDetailsModal
      ship={ship}
      onClose={onClose}
      badges={
        visitable && (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/40 px-2.5 py-0.5 text-xs text-emerald-300">
            <Footprints className="h-3 w-3" /> {t("fleet.visitableInterior")}
          </span>
        )
      }
      extraActions={
        <>
          {ship.shipDataId != null && (
            <button type="button" onClick={() => navigate(`${hubTabPath("ships", "3d")}?ship=${ship.shipDataId}`)} className={action}>
              <Box className="h-4 w-4" /> {t("fleet.view3d")}
            </button>
          )}
          <button type="button" onClick={() => navigate(hubTabPath("fleet", "assurances"))} className={action}>
            <ShieldCheck className="h-4 w-4" /> {t("fleet.openInsurance")}
          </button>
        </>
      }
      footer={
        (onExtend || onDelete) && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-white/10 px-6 py-3">
            {onExtend && (
              <>
                <span className="text-[11px] text-white/45">{t("shipCard.addDays")}</span>
                {RENTAL_EXTEND_OPTIONS.map((d) => (
                  <button key={d} type="button" onClick={() => onExtend(d)} className="rounded-md border border-[var(--accent)]/40 bg-[var(--accent-muted)] px-2 py-0.5 text-[11px] font-semibold text-white hover:brightness-125">
                    +{d}
                  </button>
                ))}
              </>
            )}
            {onDelete && (
              <button
                type="button"
                onClick={() => (confirming ? onDelete() : setConfirming(true))}
                onBlur={() => setConfirming(false)}
                className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-red-400/30 px-2.5 py-1 text-[12px] text-red-300 hover:bg-red-400/10"
              >
                <Trash2 className="h-3.5 w-3.5" /> {t(confirming ? "fleet.confirmRemove" : "shipCard.remove")}
              </button>
            )}
          </div>
        )
      }
    />
  );
}
