import { Users, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { normalizeRsiCategory } from "../../../lib/shipCategory";
import { acqBadge, formatPriceUsd, insuranceBadge } from "../helpers";
import type { ShipRow, ShipView } from "../types";

interface Props {
  ship: ShipRow;
  view: ShipView;
  onClick: () => void;
  onDelete?: () => void;
  onExtend?: (days: number) => void;
}

const RENTAL_EXTEND_OPTIONS = [1, 3, 7, 30];

/* Carte vaisseau image-forward (refonte « Hangar Dashboard ») : image pleine, pastilles
   acquisition + assurance en surimpression, valeur en avant. Actions (prolonger loc. /
   retirer) révélées au survol. Deux rendus : grille (vitrine) et liste (compact). */
export default function FleetShipCard({ ship, view, onClick, onDelete, onExtend }: Props) {
  const { t } = useTranslation();
  const manufacturer = ship.shipDataManufacturer ?? ship.manufacturer;
  const ins = insuranceBadge(ship, t);
  const acq = acqBadge(ship, t);
  const InsIcon = ins.icon;
  const price = ship.currentValueUsd;
  const category = normalizeRsiCategory(ship.shipDataRole);
  const hasActions = !!onDelete || (!!onExtend && ship.acquisition === "rented");

  const insPill = (
    <span
      className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide backdrop-blur"
      style={{ color: ins.color, background: ins.bg, border: `1px solid ${ins.border}` }}
    >
      <InsIcon className="h-3 w-3" />
      {ins.label}
    </span>
  );
  const acqPill = acq && (
    <span
      className="rounded-md px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide backdrop-blur"
      style={{ color: acq.color, background: acq.bg, border: "1px solid rgba(255,255,255,0.14)" }}
    >
      {acq.label}
    </span>
  );
  const img = ship.imageUrl ? (
    <img src={ship.imageUrl} alt="" loading="lazy" className="h-full w-full object-contain" />
  ) : (
    <div className="grid h-full w-full place-items-center text-[11px] text-white/20">{t("common.noImage")}</div>
  );

  const actionsBar = hasActions && (
    <div onClick={(e) => e.stopPropagation()} className="flex flex-wrap items-center gap-1.5">
      {onExtend && ship.acquisition === "rented" && (
        <>
          <span className="text-[10px] text-white/40">{t("shipCard.addDays")}</span>
          {RENTAL_EXTEND_OPTIONS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => onExtend(d)}
              className="rounded-md border border-[#60a5fa]/30 bg-[#60a5fa]/10 px-2 py-0.5 text-[11px] font-semibold text-[#93c5fd] hover:bg-[#60a5fa]/20"
            >
              +{d}
            </button>
          ))}
        </>
      )}
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          title={t("shipCard.remove")}
          className="ml-auto flex items-center gap-1.5 rounded-md border border-[#f26d6d]/30 bg-[#f26d6d]/10 px-2 py-1 text-[11px] font-semibold text-[#ff9a9a] hover:bg-[#f26d6d]/20"
        >
          <Trash2 className="h-3.5 w-3.5" />
          {t("shipCard.remove")}
        </button>
      )}
    </div>
  );

  if (view === "list") {
    return (
      <article
        onClick={onClick}
        className="flex cursor-pointer items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] p-2 pr-3 transition-colors hover:border-[var(--accent)]/45"
      >
        <div className="relative h-16 w-28 shrink-0 overflow-hidden rounded-lg bg-gradient-to-br from-[#20202e] to-[#14141d]">{img}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-white">{ship.name}</span>
            {acqPill}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-white/45">
            <span className="uppercase tracking-wider">{manufacturer}</span>
            {category && <span className="opacity-50">·</span>}
            {category && <span>{category}</span>}
            {ship.crewMax != null && (
              <span className="flex items-center gap-1">
                <Users className="h-3 w-3" />
                {ship.crewMax}
              </span>
            )}
          </div>
        </div>
        {hasActions ? actionsBar : null}
        {insPill}
        {price != null && price > 0 && (
          <span className="w-20 shrink-0 text-right text-sm font-bold tabular-nums text-white">{formatPriceUsd(price)}</span>
        )}
      </article>
    );
  }

  return (
    <article
      onClick={onClick}
      className="group relative aspect-[16/10] cursor-pointer overflow-hidden rounded-2xl border border-white/[0.08] bg-gradient-to-br from-[#20202e] to-[#14141d] transition hover:-translate-y-0.5 hover:border-[var(--accent)]/45"
    >
      <div className="absolute inset-0">{img}</div>
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent" />
      <div className="absolute left-2.5 top-2.5 z-10">{acqPill}</div>
      <div className="absolute right-2.5 top-2.5 z-10">{insPill}</div>

      <div className="absolute inset-x-0 bottom-0 z-10 p-3">
        <div className="truncate text-[15px] font-bold text-white">{ship.name}</div>
        <div className="text-[10px] uppercase tracking-wider text-white/45">{manufacturer}</div>
        <div className="mt-1.5 flex items-center justify-between gap-2">
          {price != null && price > 0 ? (
            <span className="text-[17px] font-bold tabular-nums text-white">{formatPriceUsd(price)}</span>
          ) : (
            <span />
          )}
          {category && (
            <span className="rounded-md border border-[var(--accent)]/30 px-1.5 py-0.5 text-[9.5px] uppercase tracking-wide text-[#818cf8]">
              {category}
            </span>
          )}
        </div>
      </div>

      {hasActions && (
        <div className="absolute inset-x-0 bottom-0 z-20 translate-y-full bg-black/85 p-2.5 backdrop-blur-sm transition-transform duration-150 group-hover:translate-y-0">
          {actionsBar}
        </div>
      )}
    </article>
  );
}
