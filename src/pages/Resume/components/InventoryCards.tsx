import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import type { InvRow } from "../../Inventory/aggregate";

/** « Sur moi » (5 premiers objets) et « Laissé ailleurs » (lieux qui gardent des objets). */
export function InventoryCards({ onMe, places }: { onMe: InvRow[]; places: { name: string; count: number }[] }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const units = onMe.reduce((n, r) => n + r.qte, 0);
  const top = [...onMe].sort((a, b) => b.qte - a.qte).slice(0, 5);
  return (
    <>
      <section className="glass rounded-[18px] px-5 py-[18px]">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-white/40">{t("inventory.onMe")}</h3>
          <span className="text-xs tabular-nums text-white/55">{t("inventory.scopeSummary", { types: onMe.length, units })}</span>
        </div>
        <div className="mt-2.5">
          {top.length === 0 && <p className="py-2 text-sm text-white/50">{t("inventory.empty")}</p>}
          {top.map((r) => (
            <div key={r.classe} className="flex justify-between gap-3 border-b border-white/[0.06] py-[7px] last:border-b-0">
              <span className="truncate text-white/85">{r.nom}</span>
              <b className="tabular-nums text-white">×{r.qte.toLocaleString(i18n.language)}</b>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => navigate("/inventory/inventaire")} className="mt-3 w-full rounded-[11px] border border-white/15 bg-white/[0.06] px-3.5 py-2 text-sm font-semibold text-white hover:bg-white/10">
          {t("resume.allInventory")}
        </button>
      </section>
      <section className="glass mt-4 rounded-[18px] px-5 py-[18px]">
        <h3 className="mb-3 text-[10.5px] font-bold uppercase tracking-[0.16em] text-white/40">{t("resume.elsewhere")}</h3>
        {places.length === 0 ? (
          <p className="text-sm text-white/50">{t("resume.nothingElsewhere")}</p>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {places.slice(0, 6).map((p) => (
              <button
                key={p.name}
                type="button"
                onClick={() => navigate("/inventory/inventaire")}
                className="rounded-xl border border-white/[0.09] bg-white/[0.04] p-3 text-left hover:bg-white/[0.07]"
              >
                <b className="block text-lg tabular-nums text-white">{p.count.toLocaleString(i18n.language)}</b>
                <span className="text-xs text-white/55">{t("resume.itemsAt", { place: p.name })}</span>
              </button>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
