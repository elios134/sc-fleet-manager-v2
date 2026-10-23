import { useTranslation } from "react-i18next";
import { Minus, Plus } from "lucide-react";
import { appLocale } from "../../../lib/format";
import type { CraftPlan } from "../hooks/useCraftPlan";

const num = (n: number) => n.toLocaleString(appLocale(), { maximumFractionDigits: 2 });
const step = "grid h-7 w-7 place-items-center rounded-lg border border-white/15 bg-white/5 text-white/80 enabled:hover:bg-white/10 disabled:opacity-35";

/** Ce qu'il me manque : quantité à fabriquer, puis par ingrédient besoin / possédé / manque. */
export function CraftNeedsCard({ plan }: { plan: CraftPlan }) {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-2.5 rounded-xl border border-white/10 bg-white/[0.02] p-3.5" aria-label={t("crafting.needs.title")}>
      <div className="flex items-center gap-2">
        <h3 className="flex-1 text-[11px] font-bold uppercase tracking-[0.1em] text-white/55">{t("crafting.needs.title")}</h3>
        <span className="text-[11.5px] text-white/45">{t("crafting.needs.qty")}</span>
        <button type="button" className={step} disabled={plan.qty <= 1} onClick={() => plan.setQty(plan.qty - 1)} aria-label={t("crafting.needs.less")}>
          <Minus className="h-3.5 w-3.5" />
        </button>
        <b className="min-w-[24px] text-center font-mono text-[13px] text-white">{plan.qty}</b>
        <button type="button" className={step} disabled={plan.qty >= 99} onClick={() => plan.setQty(plan.qty + 1)} aria-label={t("crafting.needs.more")}>
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      {plan.needs.map((n) => {
        const unit = n.resource ? " SCU" : "";
        const pct = n.need > 0 ? Math.min(100, (n.owned / n.need) * 100) : 100;
        return (
          <div key={n.ref} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5 rounded-lg border border-white/[0.07] bg-white/[0.02] px-2.5 py-2">
            <div className="min-w-0">
              <p className="truncate text-[12.5px] font-semibold text-white">
                {n.name}
                <span className="ml-1.5 rounded-full border border-white/10 px-1.5 text-[9.5px] font-bold uppercase text-white/45">
                  {t(n.resource ? "crafting.needs.resource" : "crafting.needs.item")}
                </span>
              </p>
              <label className="mt-0.5 flex items-center gap-1.5 text-[11px] text-white/45">
                {t("crafting.needs.owned")}
                <input
                  type="number"
                  min={0}
                  step={n.resource ? 0.01 : 1}
                  value={n.owned}
                  onChange={(e) => plan.setOwned(n.ref, Number(e.target.value))}
                  className="w-16 rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[11px] text-white"
                />
                / {num(n.need)}
                {unit}
              </label>
            </div>
            <span className={`font-mono text-[12.5px] font-bold ${n.missing > 0 ? "text-amber-300" : "text-emerald-300"}`}>
              {n.missing > 0 ? `− ${num(n.missing)}${unit}` : "✓"}
            </span>
            <div className="col-span-2 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
              <div className={`h-full rounded-full ${n.missing > 0 ? "bg-[var(--amber)]" : "bg-emerald-400"}`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
      <p className="text-[10.5px] text-white/35">{t("crafting.needs.hint")}</p>
    </section>
  );
}
