import { useTranslation } from "react-i18next";
import type { GeoPoi } from "../starmapData";
import { poiLegend } from "../panel";
import { POI_BADGE } from "./panelSections";

/** Légende du globe : lieux du corps par type (même pastille que la liste de la fiche). */
export function PoiLegend({ pois }: { pois: GeoPoi[] }) {
  const { t } = useTranslation();
  const items = poiLegend(pois);
  return (
    <div className="glass flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 rounded-2xl px-3 py-2" aria-label={t("starmap.legend")}>
      {items.length === 0 ? (
        <span className="text-[11.5px] text-white/45">{t("starmap.legendEmpty")}</span>
      ) : (
        items.map(({ kind, count }) => (
          <span key={kind} className="flex items-center gap-1.5 text-[11.5px] text-white/75">
            <span className={`grid h-4 w-4 place-items-center rounded text-[9px] font-extrabold ${POI_BADGE[kind]}`}>
              {t(`starmap.poiKind.${kind}`).charAt(0).toUpperCase()}
            </span>
            {t(`starmap.poiKind.${kind}`)}
            <b className="font-mono tabular-nums text-white/45">{count}</b>
          </span>
        ))
      )}
    </div>
  );
}
