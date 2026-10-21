import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, Clock, ExternalLink, Loader2, Hammer, Package, Trophy, Recycle } from "lucide-react";
import { formatCraftTime, familyLabel, familyOf } from "../helpers";
import { BlueprintThumb } from "./BlueprintThumb";
import { IngredientMiningModal } from "./IngredientMiningModal";

import { useBlueprintDetail } from "../hooks/useBlueprintDetail";
import { BlueprintDetailsTab, BlueprintCraftTab, BlueprintMissionTab, BlueprintRecycleTab } from "./BlueprintTabs";

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
  const bp = { ...useBlueprintDetail({ blueprintId, accountId, isOwned, onToggleOwned }), blueprintId, accountId, isOwned, onToggleOwned };
  const {
    t,
    detail,
    loading,
    error,
    miningIngredient,
    setMiningIngredient,
    tab,
    setTab,
    it,
  } = bp;
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
                {tab === "object" && <BlueprintDetailsTab bp={bp} />}

                {/* ── CRAFT : slots (matière + curseur qualité, base 500) ── */}
                {tab === "craft" && <BlueprintCraftTab bp={bp} />}

                {/* ── MISSION : systèmes + missions de déblocage ── */}
                {tab === "mission" && <BlueprintMissionTab bp={bp} />}

                {/* ── RECYCLAGE : temps + rendement + ressources rendues (démantèlement Wiki) ── */}
                {tab === "recycle" && <BlueprintRecycleTab bp={bp} />}
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
