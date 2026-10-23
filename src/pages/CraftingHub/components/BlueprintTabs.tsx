import { groupIngredientsBySlot, formatCraftTime } from "../helpers";
import { IngredientRow } from "./IngredientRow";
import { SlotBlock } from "./SlotBlock";
import { DataRow } from "./DataRow";
import { CraftPlanSection } from "./CraftPlanSection";

import type { BlueprintDetailState } from "../hooks/useBlueprintDetail";

/** Onglet Détails : description, données et axes de qualité. */
export function BlueprintDetailsTab({ bp }: { bp: BlueprintDetailState }) {
  const {
    t,
    detail,
    it,
    craftAxes,
  } = bp;
  // Rendu seulement quand le détail est chargé (cf. BlueprintDetailPanel).
  if (!detail) return null;
  return (
    <>
      <div className="flex flex-col gap-5">
        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--amber)" }}>
            {t('crafting.descriptionData')}
          </h3>
          {it?.description && (
            <p className="mb-3 whitespace-pre-wrap text-[12px] leading-relaxed text-white/60">{it.description}</p>
          )}
          {detail.blueprint.descriptionData && detail.blueprint.descriptionData.length > 0 ? (
            <div className="divide-y divide-white/5 rounded-xl border border-white/10 bg-white/5">
              {detail.blueprint.descriptionData.map((d, i) => (
                <DataRow key={`${d.name}-${i}`} label={d.name} value={d.value} />
              ))}
            </div>
          ) : (
            <p className="text-[12px] italic text-white/30">{t('crafting.noDescriptiveData')}</p>
          )}
        </section>
        {craftAxes.length > 0 && (
          <section>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--amber)" }}>
              {t('crafting.craftAxes')}
            </h3>
            <div className="divide-y divide-white/5 rounded-xl border border-white/10 bg-white/5">
              {craftAxes.map((a) => (
                <div key={a.label} className="flex items-center justify-between gap-2 px-3 py-2 text-[13px]">
                  <span className="text-white/70">{a.label}</span>
                  {a.betterWhen === "lower" ? (
                    <span className="text-[15px] text-red-300" aria-label={t('crafting.lowerIsBetter')}>↓</span>
                  ) : (
                    <span className="text-[15px] text-emerald-300" aria-label={t('crafting.higherIsBetter')}>↑</span>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </>
  );
}

/** Onglet Craft : emplacements, matières et curseurs de qualité. */
export function BlueprintCraftTab({ bp }: { bp: BlueprintDetailState }) {
  const {
    t,
    detail,
    setMiningIngredient,
    qualityBySlot,
    setQualityBySlot,
  } = bp;
  // Rendu seulement quand le détail est chargé (cf. BlueprintDetailPanel).
  if (!detail) return null;
  return (
    <>
      {detail.ingredients.length > 0 && <CraftPlanSection detail={detail} />}
      {detail.ingredients.length === 0 ? (
        <p className="text-[12px] italic text-white/30">{t('crafting.noIngredient')}</p>
      ) : (
        (() => {
          const slotGroups = groupIngredientsBySlot(detail.ingredients);
          if (slotGroups) {
            return (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {slotGroups.map((g, gi) => (
                    <SlotBlock
                      key={`${detail.blueprint.id}-${gi}`}
                      group={g}
                      quality={qualityBySlot[g.slotName]}
                      onQuality={(v) => setQualityBySlot((p) => ({ ...p, [g.slotName]: v }))}
                      onMine={(ref, name) => setMiningIngredient({ ref, name })}
                    />
                  ))}
                </div>
                <p className="mt-3 text-[10px] italic text-white/30">{t('crafting.slidersHint')}</p>
              </>
            );
          }
          return (
            <div className="flex flex-col gap-1.5">
              {detail.ingredients.map((ing, i) => (
                <IngredientRow key={i} ing={ing} onMine={(ref, name) => setMiningIngredient({ ref, name })} />
              ))}
            </div>
          );
        })()
      )
      }
    </>
  );
}

/** Onglet Mission : systèmes et missions de déblocage. */
export function BlueprintMissionTab({ bp }: { bp: BlueprintDetailState }) {
  const {
    t,
    detail,
    linkedSystems,
  } = bp;
  // Rendu seulement quand le détail est chargé (cf. BlueprintDetailPanel).
  if (!detail) return null;
  return (
    <>
      {detail.linkedMissions.length === 0 ? (
        <p className="text-[12px] italic text-white/30">{t('crafting.noUnlockMission')}</p>
      ) : (
        <div className="flex flex-col gap-4">
          {linkedSystems.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {linkedSystems.map((s) => (
                <span
                  key={s}
                  className="rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider"
                  style={{
                    borderColor: "color-mix(in oklab, var(--accent) 30%, transparent)",
                    background: "color-mix(in oklab, var(--accent) 8%, transparent)",
                    color: "var(--accent)",
                  }}
                >
                  {s}
                </span>
              ))}
            </div>
          )}
          <ul className="flex flex-col gap-1.5">
            {detail.linkedMissions.map((m) => {
              const systems = (m.starSystems ?? "").split(",").map((x) => x.trim()).filter(Boolean);
              return (
                <li key={m.missionUuid} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                  <div className="flex items-start justify-between gap-2.5">
                    <div className="min-w-0">
                      <div className="truncate text-[13px] text-white/90">{m.title}</div>
                      {m.factionName && (
                        <div className="text-[10px] uppercase tracking-[0.08em] text-white/40">{m.factionName}</div>
                      )}
                    </div>
                    <span className="shrink-0 text-[12px] tabular-nums" style={{ color: "#c2773f" }}>
                      {Math.round(m.weight * 100)} %
                    </span>
                  </div>
                  {systems.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {systems.map((s) => (
                        <span
                          key={s}
                          className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] uppercase tracking-wider text-white/55"
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )
      }
    </>
  );
}

/** Onglet Recyclage : temps, rendement et ressources rendues. */
export function BlueprintRecycleTab({ bp }: { bp: BlueprintDetailState }) {
  const {
    t,
    detail,
    dismantle,
    dismantleLoading,
  } = bp;
  // Rendu seulement quand le détail est chargé (cf. BlueprintDetailPanel).
  if (!detail) return null;
  return (
    <>
      {dismantleLoading && !dismantle ? (
        <p className="text-[12px] italic text-white/30">{t('crafting.loadingShort')}</p>
      ) : !dismantle ? (
        <p className="text-[12px] italic text-white/30">{t('crafting.recycleEmpty')}</p>
      ) : (
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="text-[12px] text-white/55">
            {dismantle.timeLabel ??
              t('crafting.recycleTime', { time: formatCraftTime(dismantle.timeSeconds) })}
            {dismantle.efficiency != null &&
              ` · ${Math.round(dismantle.efficiency * 100)} % ${t('crafting.recycleEfficiency')}`}
          </p>
          {dismantle.returns.length > 0 && (
            <table className="mt-3 w-full text-[13px]">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-white/40">
                  <th className="pb-1.5">{t('crafting.recycleResource')}</th>
                  <th className="pb-1.5 text-right">{t('crafting.recycleQuantity')}</th>
                </tr>
              </thead>
              <tbody>
                {dismantle.returns.map((r, ri) => (
                  <tr key={ri} className="border-t border-white/[0.06]">
                    <td className="py-2 text-white/85">{r.name ?? "—"}</td>
                    <td className="py-2 text-right tabular-nums text-white/70">
                      {r.quantityScu != null ? `${r.quantityScu.toFixed(3)} SCU` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )
      }
    </>
  );
}
