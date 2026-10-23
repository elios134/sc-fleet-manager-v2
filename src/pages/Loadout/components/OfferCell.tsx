import { useTranslation } from "react-i18next";
import { Check, Plus } from "lucide-react";
import { appLocale } from "../../../lib/format";
import { offerPlace, type PlacedOffer } from "../lib/shopping";

const fmt = (n: number) => Math.round(n).toLocaleString(appLocale());

/** Colonne « Où l'acheter » du sélecteur : terminal retenu, lieu, distance, prix et ajout à la
 *  liste d'achats. « Non vendu en boutique » sans offre. */
export function OfferCell({ offer, inCart, onToggle }: { offer: PlacedOffer | null; inCart: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  if (!offer) return <div className="w-[230px] shrink-0 text-[11px] text-white/30">{t("loadout.offer.notSold")}</div>;
  const gm = offer.gm == null ? "—" : offer.gm < 0.05 ? t("loadout.offer.here") : `${offer.gm.toLocaleString(appLocale(), { maximumFractionDigits: 1 })} Gm`;
  return (
    <div className="flex w-[230px] shrink-0 items-center gap-2" onClick={(e) => e.stopPropagation()}>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11.5px] text-white/75" title={offer.terminal}>{offer.terminal}</p>
        <p className="truncate text-[10px] text-white/40">
          {offerPlace(offer)} · <span className="font-mono">{gm}</span>
        </p>
      </div>
      <span className="font-mono text-[11.5px] tabular-nums text-white">{fmt(offer.price)}</span>
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={inCart}
        aria-label={inCart ? t("loadout.offer.remove") : t("loadout.offer.add")}
        title={inCart ? t("loadout.offer.remove") : t("loadout.offer.add")}
        className={`grid h-6 w-6 place-items-center rounded-md border ${inCart ? "border-[var(--accent)] bg-[var(--accent)] text-white" : "border-white/15 bg-white/5 text-white/70 hover:bg-white/10"}`}
      >
        {inCart ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}
