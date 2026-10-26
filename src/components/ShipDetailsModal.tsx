import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import type { ShipRow } from "../pages/Fleet";
import { ShipDetailsBody } from "./ship/ShipDetailsBody";

/* Modale de détail d'un vaisseau (pages Pack et Ma flotte) : la fiche partagée dans une fenêtre,
   avec des actions et pastilles en plus (`extraActions`, `badges`) et un pied de fenêtre (`footer`) au besoin. */
export default function ShipDetailsModal({
  ship,
  onClose,
  extraActions,
  badges,
  footer,
}: {
  ship: ShipRow;
  onClose: () => void;
  extraActions?: ReactNode;
  badges?: ReactNode;
  footer?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative z-10 flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[var(--card-border)] bg-[var(--background)]/95 backdrop-blur-2xl"
      >
        <button onClick={onClose} className="absolute right-3 top-3 z-10 rounded-lg p-1 text-white/60 hover:bg-white/10" aria-label={t("shipDetails.close")}>
          <X className="h-5 w-5" />
        </button>
        <ShipDetailsBody ship={ship} onLeave={onClose} extraActions={extraActions} badges={badges} />
        {footer}
      </div>
    </div>
  );
}
