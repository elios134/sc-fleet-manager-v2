import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { usePersistentState } from "../../../lib/uiPersist";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, Clock, ExternalLink, Loader2, Hammer, Package, Trophy, Recycle } from "lucide-react";
import { type BlueprintStat } from "../../../lib/craftingStats";
import { type BlueprintDetail, type Dismantle } from "../types";
import { groupIngredientsBySlot, formatCraftTime, familyLabel, familyOf } from "../helpers";
import { IngredientRow } from "./IngredientRow";
import { SlotBlock } from "./SlotBlock";
import { BlueprintThumb } from "./BlueprintThumb";
import { DataRow } from "./DataRow";
import { IngredientMiningModal } from "./IngredientMiningModal";

// Cache mémoire du démantèlement par blueprint : une seule requête Wiki par objet
// pour toute la durée de vie de la session (l'onglet Recyclage n'appelle plus le réseau
// à chaque réouverture).
const dismantleCache = new Map<string, Dismantle>();

function BlueprintDetailPanel({
  blueprintId,
  accountId,
  isOwned,
  onToggleOwned,
}: {
  blueprintId: string;
  accountId: string;
  isOwned: boolean;
  onToggleOwned: () => void;
}) {
  const { t } = useTranslation();
  const [detail, setDetail] = useState<BlueprintDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Ingrédient dont on affiche les localisations de minage (modale « où miner »).
  const [miningIngredient, setMiningIngredient] = useState<{ ref: string; name: string } | null>(
    null,
  );
  // Qualité PARTAGÉE par slot (clé = slotName brut, ex. « FRAME »). Vide → défaut 500/initial.
  // Pilote les curseurs des cartes ET le recalcul live des stats agrégées (computeStackedStatValue).
  const [qualityBySlot, setQualityBySlot] = useState<Record<string, number>>({});
  // Onglet actif de la fiche (Détails / Craft / Mission / Recyclage) — persistant.
  const [tab, setTab] = usePersistentState<"object" | "craft" | "mission" | "recycle">(
    "crafting.detailTab",
    "object",
  );
  // Recyclage : chargé paresseusement à l'ouverture de l'onglet, mis en cache par blueprint.
  const [dismantle, setDismantle] = useState<Dismantle>(null);
  const [dismantleLoading, setDismantleLoading] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setQualityBySlot({}); // réinitialise au changement de blueprint
    setDismantle(dismantleCache.get(blueprintId) ?? null); // valeur en cache si déjà chargée
    invoke<BlueprintDetail | null>("get_blueprint_detail", { blueprintId, accountId })
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [blueprintId, accountId]);

  // Fetch paresseux du recyclage : uniquement quand l'onglet Recyclage est ouvert et
  // que ce blueprint n'est pas déjà en cache (une requête Wiki max par objet/session).
  useEffect(() => {
    if (tab !== "recycle" || dismantleCache.has(blueprintId)) return;
    let cancelled = false;
    setDismantleLoading(true);
    invoke<Dismantle>("get_blueprint_dismantle", { blueprintId })
      .then((d) => {
        dismantleCache.set(blueprintId, d ?? null);
        if (!cancelled) setDismantle(d ?? null);
      })
      .catch(() => {
        if (!cancelled) setDismantle(null);
      })
      .finally(() => {
        if (!cancelled) setDismantleLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, blueprintId]);

  const it = detail?.itemDetails ?? null;

  // Stats réactives : regroupées par gpp (1 carte) ; slots distincts (1 slider).
  const stats = useMemo(() => (detail?.stats ?? []) as BlueprintStat[], [detail]);
  const statGroups = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, BlueprintStat[]>();
    for (const s of stats) {
      if (!map.has(s.gpp)) {
        map.set(s.gpp, []);
        order.push(s.gpp);
      }
      map.get(s.gpp)!.push(s);
    }
    return order.map((gpp) => ({ gpp, label: map.get(gpp)![0]!.statNameLocKey, entries: map.get(gpp)! }));
  }, [stats]);

  // Axes de qualité (onglet Détails) : labels distincts des modifiers de tous les slots
  // (les MÊMES que le simulateur Craft) + labels de stats lisibles (hors clés LOC « @… »).
  const craftAxes = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ label: string; betterWhen: string | null }> = [];
    const add = (l: string | null | undefined, betterWhen: string | null) => {
      const v = l?.trim();
      if (v && !v.startsWith("@") && !seen.has(v.toLowerCase())) {
        seen.add(v.toLowerCase());
        out.push({ label: v, betterWhen });
      }
    };
    for (const ing of detail?.ingredients ?? []) {
      for (const m of ing.modifiers ?? []) add(m.label, m.better_when ?? null);
    }
    for (const g of statGroups) add(g.label, null); // stats sans sens « bon » connu
    return out;
  }, [detail, statGroups]);

  // Systèmes agrégés des missions liées (starSystems = chaîne « Nyx, Pyro, Stanton »).
  const linkedSystems = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const m of detail?.linkedMissions ?? []) {
      for (const s of (m.starSystems ?? "").split(",").map((x) => x.trim()).filter(Boolean)) {
        if (!seen.has(s.toLowerCase())) {
          seen.add(s.toLowerCase());
          out.push(s);
        }
      }
    }
    return out;
  }, [detail]);

  // Panneau fiche, rendu INLINE dans la colonne droite (plus de modale overlay).
  const bpPanel = (
    <div className="relative w-full text-[13px] text-white/90">
          {loading ? (
            <div className="flex items-center justify-center gap-2 px-8 py-20 text-white/50">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('crafting.loadingShort')}
            </div>
          ) : error || !detail ? (
            <div className="px-8 py-20 text-center text-sm text-red-300">
              {error ?? t('crafting.blueprintNotFound')}
            </div>
          ) : (
            <>
              {/* ── En-tête (aligné captures Multitool) : vignette + surtitre + nom + badges + 4 cartes + craft ── */}
              <header
                className="border-b border-white/10 px-6 py-5"
                style={{
                  background:
                    "radial-gradient(ellipse at top right, color-mix(in oklab, var(--accent) 10%, transparent), transparent 70%)",
                }}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 items-start gap-4">
                    <BlueprintThumb
                      imageUrl={detail.blueprint.imageUrl}
                      category={detail.blueprint.category ?? ""}
                      name={detail.blueprint.displayName}
                      sizeClass="h-70 w-70"
                      iconClass="h-22 w-22"
                      radiusClass="rounded-xl"
                    />
                    <div className="min-w-0">
                      <div
                        className="text-[10px] font-semibold uppercase tracking-[0.16em]"
                        style={{ color: "#c2773f" }}
                      >
                        {[familyLabel(familyOf(detail.blueprint.category ?? ""), t), it?.itemType]
                          .filter(Boolean)
                          .join(" · ") || detail.blueprint.category || "—"}
                      </div>
                      <h2
                        className="mt-0.5 text-[22px] font-semibold leading-tight text-white"
                        style={{
                          fontStyle: detail.blueprint.displayNameSource === "recordName" ? "italic" : "normal",
                        }}
                        title={detail.blueprint.displayName}
                      >
                        {detail.blueprint.displayName}
                        {detail.blueprint.displayNameSource === "recordName" && <span className="text-white/30"> ?</span>}
                      </h2>
                      {/* Badges compacts : type · grade · taille · fabricant */}
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {[
                          it?.itemType,
                          it?.grade,
                          it?.size != null ? `S${it.size}` : null,
                          it?.manufacturer,
                        ]
                          .filter(Boolean)
                          .map((b, i) => (
                            <span
                              key={i}
                              className="rounded-full border border-white/12 bg-white/5 px-2 py-0.5 text-[10px] font-medium text-white/70"
                            >
                              {b}
                            </span>
                          ))}
                      </div>
                    </div>
                  </div>

                  {/* Bouton Possédé (haut droite) */}
                  <button
                    onClick={onToggleOwned}
                    className={[
                      "inline-flex shrink-0 items-center gap-2 self-start rounded-lg border px-4 py-2 text-[12px] font-semibold uppercase tracking-wider transition-colors",
                      isOwned
                        ? "border-emerald-500/50 text-emerald-300"
                        : "border-white/10 bg-white/5 text-white/60 hover:border-emerald-500/40 hover:text-emerald-300",
                    ].join(" ")}
                    style={
                      isOwned
                        ? { background: "rgba(16,185,129,0.18)", boxShadow: "inset 0 0 0 1px rgba(16,185,129,0.30)" }
                        : undefined
                    }
                  >
                    {isOwned ? (
                      <>
                        <Check className="h-3.5 w-3.5" /> {t('crafting.owned')}
                      </>
                    ) : (
                      t('crafting.markAsObtained')
                    )}
                  </button>
                </div>

                {/* Rangée de 4 cartes : Grade / Size / Class / Manufacturer */}
                <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  {(
                    [
                      [t('crafting.cardGrade'), it?.grade],
                      [t('crafting.cardSize'), it?.size != null ? `S${it.size}` : null],
                      [t('crafting.cardClass'), it?.className],
                      [t('crafting.cardManufacturer'), it?.manufacturer],
                    ] as const
                  ).map(([label, value], i) => (
                    <div key={i} className="flex flex-col gap-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                      <span className="text-[9px] uppercase tracking-[0.14em] text-white/35">{label}</span>
                      <span className="truncate text-[13px] font-medium text-white/90" title={value || "—"}>
                        {value || "—"}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Craft <temps> · fabricant + Wiki */}
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-1.5 text-[12px] tabular-nums" style={{ color: "var(--accent)" }}>
                    <Clock className="h-3.5 w-3.5" />
                    {t('crafting.craftLabel', { time: formatCraftTime(detail.blueprint.craftTimeSeconds) })}
                    {it?.manufacturer && <span className="text-white/40"> · {it.manufacturer}</span>}
                  </span>
                  {detail.blueprint.webUrl && (
                    <button
                      type="button"
                      onClick={() => void openUrl(detail.blueprint.webUrl as string)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[12px] font-medium text-white/80 transition-colors hover:border-accent/40 hover:text-accent"
                    >
                      <ExternalLink className="h-3.5 w-3.5" /> {t('crafting.wiki')}
                    </button>
                  )}
                </div>
              </header>

              {/* ── Onglets : Détails / Craft / Mission / Recyclage (aligné captures Multitool) ── */}
              <div className="flex items-center gap-1 border-b border-white/10 px-6 pt-3">
                {(
                  [
                    ["object", t('crafting.tabDetails'), Package],
                    ["craft", t('crafting.tabCraft'), Hammer],
                    ["mission", t('crafting.tabMission'), Trophy],
                    ["recycle", t('crafting.tabRecycle'), Recycle],
                  ] as const
                ).map(([key, label, Icon]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setTab(key)}
                    className={[
                      "relative flex items-center gap-1.5 px-4 py-2 text-[12px] font-semibold uppercase tracking-wider transition-colors",
                      tab === key ? "text-accent" : "text-white/45 hover:text-white/80",
                    ].join(" ")}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                    {tab === key && (
                      <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full" style={{ background: "var(--accent)" }} />
                    )}
                  </button>
                ))}
              </div>

              <div className="px-6 py-5">
                {/* ── DÉTAILS : Description Data + axes craft ── */}
                {tab === "object" && (
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
                )}

                {/* ── CRAFT : slots (matière + curseur qualité, base 500) ── */}
                {tab === "craft" && (
                  detail.ingredients.length === 0 ? (
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
                )}

                {/* ── MISSION : systèmes + missions de déblocage ── */}
                {tab === "mission" && (
                  detail.linkedMissions.length === 0 ? (
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
                )}

                {/* ── RECYCLAGE : temps + rendement + ressources rendues (démantèlement Wiki) ── */}
                {tab === "recycle" && (
                  dismantleLoading && !dismantle ? (
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
                )}
              </div>
            </>
          )}
        </div>
  );

  return (
    <>
      {bpPanel}
      {/* Modale « où miner » (overlay), ouverte depuis un ingrédient du Craft. */}
      {miningIngredient && (
        <IngredientMiningModal
          ingredientRef={miningIngredient.ref}
          ingredientName={miningIngredient.name}
          panelMode={false}
          onClose={() => setMiningIngredient(null)}
        />
      )}
    </>
  );
}

// (L'intégration de la modale Mission Intel reviendra au Lot R4, dans l'onglet « Mission ».)

export { BlueprintDetailPanel };
