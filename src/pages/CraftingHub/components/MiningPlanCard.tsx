import { useTranslation } from "react-i18next";
import { Route } from "lucide-react";
import { appLocale } from "../../../lib/format";
import type { CraftPlan } from "../hooks/useCraftPlan";
import type { MineMethod } from "../lib/missing";
import { METHOD_KEY, RARITY_KEY, SYSTEM_LABEL } from "../helpers";

const METHODS: MineMethod[] = ["roc", "ship", "fps"];
const num = (n: number) => n.toLocaleString(appLocale(), { maximumFractionDigits: 2 });

/** Plan de minage : pour chaque ingrédient manquant, ses lieux (méthode choisie d'abord, puis
 *  distance) ; un lieu retenu par ingrédient, puis l'itinéraire de minage sur la carte. */
export function MiningPlanCard({ plan }: { plan: CraftPlan }) {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-2.5 rounded-xl border border-white/10 bg-white/[0.02] p-3.5" aria-label={t("crafting.mine.title")}>
      <div className="flex items-center gap-2">
        <h3 className="flex-1 text-[11px] font-bold uppercase tracking-[0.1em] text-white/55">{t("crafting.mine.title")}</h3>
        <div role="group" aria-label={t("crafting.mine.method")} className="flex rounded-full border border-white/10 bg-white/5 p-0.5 text-[11px] font-semibold">
          {METHODS.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={plan.method === m}
              onClick={() => plan.setMethod(m)}
              className={`rounded-full px-2.5 py-1 ${plan.method === m ? "bg-[var(--accent)] text-white" : "text-white/55 hover:text-white"}`}
            >
              {t(`crafting.mine.${m}`)}
            </button>
          ))}
        </div>
      </div>
      {plan.plan.length === 0 ? (
        <p className="rounded-lg border border-dashed border-white/15 px-3 py-4 text-center text-[12px] text-white/50">{t("crafting.mine.nothing")}</p>
      ) : (
        plan.plan.map((p) => (
          <div key={p.need.ref} className="flex flex-col gap-1.5">
            <p className="flex items-center gap-2 text-[12.5px] font-semibold text-white">
              {p.need.name}
              <span className="rounded-full border border-[var(--amber)]/40 bg-[var(--amber-muted)] px-2 text-[10px] font-bold text-amber-300">
                − {num(p.need.missing)}
                {p.need.resource ? " SCU" : ""}
              </span>
            </p>
            {p.spots.slice(0, 5).map((s) => (
              <button
                key={s.key}
                type="button"
                aria-pressed={p.picked === s.key}
                onClick={() => plan.pick(p.need.ref, s.key)}
                className={`flex items-center gap-2.5 rounded-lg border px-2.5 py-1.5 text-left ${
                  p.picked === s.key ? "border-[var(--accent)]/60 bg-[var(--accent-muted)]" : "border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.05]"
                }`}
              >
                <span className="w-16 shrink-0 text-[10px] font-bold uppercase text-white/50">{t(METHOD_KEY[s.miningMethod] ?? s.miningMethod)}</span>
                <span className="min-w-0 flex-1">
                  <b className="block truncate text-[12px] text-white">{s.bodyName}</b>
                  <small className="text-[10.5px] text-white/40">
                    {SYSTEM_LABEL[s.systemName] ?? s.systemName}
                    {s.rarity && ` · ${t(RARITY_KEY[s.rarity] ?? s.rarity)}`}
                  </small>
                </span>
                <span className="font-mono text-[11px] text-white/50">{s.gm == null ? "—" : `${num(s.gm)} Gm`}</span>
              </button>
            ))}
          </div>
        ))
      )}
      <button
        type="button"
        disabled={plan.plan.length === 0}
        onClick={plan.toMap}
        className="mt-1 flex items-center justify-center gap-2 rounded-[10px] bg-[var(--accent)] px-3 py-2 text-[12.5px] font-semibold text-white hover:brightness-110 disabled:opacity-50"
      >
        <Route className="h-4 w-4" />
        {t("crafting.mine.toMap")}
      </button>
      {!plan.hasPosition && <p className="text-[10.5px] text-white/35">{t("crafting.mine.noPosition")}</p>}
    </section>
  );
}
