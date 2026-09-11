import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import { type CraftModifier, type SlotGroup } from "../types";
import { modifierMultiplier, fmtSignedPercent } from "../helpers";

// Bloc d'un emplacement : titre + ingrédient(s) + simulateur de qualité (curseur + lignes %).
// État de qualité PAR SLOT (indépendant). Le curseur est purement visuel (aucun craft réel).
function SlotBlock({
  group,
  quality,
  onQuality,
  onMine,
}: {
  group: SlotGroup;
  quality: number | undefined; // qualité partagée (parent), undefined → défaut initial
  onQuality: (value: number) => void;
  onMine: (ref: string, name: string) => void;
}) {
  const { t } = useTranslation();
  const rep = group.items[0];
  const sliderMin = rep?.sliderMin ?? 1;
  const sliderMax = rep?.sliderMax ?? 1000;
  // Borne basse = max(sliderMin, minQuality) — on ne descend pas sous minQuality.
  const floor = Math.max(sliderMin, rep?.minQuality ?? sliderMin);
  const initial = Math.min(Math.max(rep?.initialQuality ?? 500, floor), sliderMax);
  const modifiers = rep?.modifiers ?? [];
  const hasRange = sliderMax > floor;
  const showSlider = modifiers.length > 0 && hasRange;

  // Qualité courante = valeur partagée (parent) sinon l'initiale du slot.
  const current = quality ?? initial;
  const effectiveQuality = showSlider ? current : initial;

  // Ingrédient du slot : un seul (les données n'ont pas d'alternatives / selectionGroup,
  // donc chaque groupe ne contient qu'un ingrédient).
  const sel = rep;
  // Quantité : « 0.36 SCU » pour une ressource ; « 7 items » pour un objet (reformaté
  // depuis « ×7 », le nombre brut n'étant pas exposé au front).
  const qtyRaw = sel?.quantityLabel ?? "";
  const qtyDisplay =
    sel && sel.ingredientType !== "resource" && qtyRaw.startsWith("×")
      ? t('crafting.itemsCount', { count: Number(qtyRaw.slice(1)) || 0 })
      : qtyRaw;

  function modifierColor(mod: CraftModifier, mult: number): string {
    const delta = mult - 1;
    if (Math.abs(delta) < 0.0005) return "rgba(255,255,255,0.55)";
    const improves =
      (mod.better_when === "higher" && delta > 0) || (mod.better_when === "lower" && delta < 0);
    if (mod.better_when !== "higher" && mod.better_when !== "lower")
      return "rgba(255,255,255,0.75)";
    return improves ? "#34d399" : "#f87171";
  }

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-white/10 bg-white/5 p-3.5">
      {/* Surtitre du slot (gris/cuivre, majuscules) + ×N */}
      <div className="flex items-center gap-2">
        <span
          className="text-[10px] font-semibold uppercase tracking-[0.16em]"
          style={{ color: "#c2773f" }}
        >
          {group.title}
        </span>
        {group.requiredCount != null && group.requiredCount > 1 && (
          <span className="rounded-full border border-accent/30 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
            ×{group.requiredCount}
          </span>
        )}
      </div>

      {/* Ligne : nom ingrédient (gras, cliquable → où miner) + quantité à droite */}
      <div className="flex items-baseline justify-between gap-2.5">
        <button
          type="button"
          onClick={() => sel && onMine(sel.ingredientRef, sel.ingredientName)}
          title={t('crafting.seeWhereToMine')}
          className="flex min-w-0 cursor-pointer items-center gap-1 text-left text-[13px] font-semibold text-white/90 transition-colors hover:text-accent"
        >
          <span
            className="truncate"
            style={{
              textDecoration: "underline dotted color-mix(in oklab, var(--accent) 50%, transparent)",
              textUnderlineOffset: "3px",
            }}
          >
            {sel?.ingredientName ?? "—"}
          </span>
          {/* Loupe : signale que le nom est cliquable (→ « où miner »). */}
          <Search className="h-3 w-3 shrink-0 text-white/40" />
        </button>
        <span className="shrink-0 text-[12px] tabular-nums" style={{ color: "var(--accent)" }}>
          {qtyDisplay}
        </span>
      </div>

      {/* Simulateur de qualité : curseur (si plage exploitable) + repères + lignes % */}
      {modifiers.length > 0 && (
        <div className="mt-0.5 flex flex-col gap-2 border-t border-white/10 pt-2.5">
          {showSlider && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-white/40">{t('crafting.quality')}</span>
                <span
                  className="rounded-md border px-2 py-0.5 text-[12px] tabular-nums text-accent"
                  style={{ borderColor: "color-mix(in oklab, var(--accent) 30%, transparent)", background: "color-mix(in oklab, var(--accent) 8%, transparent)" }}
                >
                  {Math.round(current)}
                </span>
              </div>
              <input
                type="range"
                min={floor}
                max={sliderMax}
                step={1}
                value={current}
                onChange={(e) => onQuality(parseInt(e.target.value, 10))}
                className="w-full accent-[var(--accent)]"
                aria-label={t('crafting.qualityAria', { slot: group.title })}
              />
              {/* Repères : min (gauche) · Base N (centre) · max (droite) */}
              <div className="flex items-center justify-between text-[9px] uppercase tracking-wider text-white/30">
                <span>{floor}</span>
                <span>{t('crafting.base', { value: initial })}</span>
                <span>{sliderMax}</span>
              </div>
            </div>
          )}
          <div className="flex flex-col gap-0.5">
            {modifiers.map((mod, i) => {
              const mult = modifierMultiplier(mod, effectiveQuality);
              return (
                <div key={i} className="flex items-center justify-between text-[11px]">
                  <span className="text-white/55">{mod.label ?? "—"}</span>
                  <span className="tabular-nums font-medium" style={{ color: modifierColor(mod, mult) }}>
                    {fmtSignedPercent(mult)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export { SlotBlock };
