import { useTranslation } from "react-i18next";
import { ArrowUpRight } from "lucide-react";
import { type CraftIngredient } from "../types";

// Ligne d'un ingrédient : nom cliquable (→ modale « où miner ») + badge type + quantité.
// Réutilisée par l'affichage groupé (par slot) et le repli à plat.
function IngredientRow({
  ing,
  onMine,
}: {
  ing: CraftIngredient;
  onMine: (ref: string, name: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="grid items-center gap-2.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2"
      style={{ gridTemplateColumns: "minmax(0,1.4fr) 70px 64px" }}
    >
      <button
        type="button"
        onClick={() => onMine(ing.ingredientRef, ing.ingredientName)}
        title={t('crafting.seeWhereToMine')}
        className="flex min-w-0 items-center gap-1.5 text-left text-[13px] text-white/85 transition-colors hover:text-accent"
        style={{
          textDecoration: "underline dotted color-mix(in oklab, var(--accent) 50%, transparent)",
          textUnderlineOffset: "3px",
        }}
      >
        <span className="truncate">{ing.ingredientName}</span>
        <ArrowUpRight className="h-3 w-3 shrink-0 text-white/40" />
      </button>
      <span
        className={[
          "rounded-full border px-1.5 py-0.5 text-center text-[10px] uppercase tracking-wider",
          ing.ingredientType === "resource"
            ? "border-emerald-500/35 text-emerald-300/90"
            : "border-accent/30 text-accent",
        ].join(" ")}
      >
        {ing.ingredientTypeLabel}
      </span>
      <span className="text-right text-[12px] tabular-nums" style={{ color: "var(--accent)" }}>
        {ing.quantityLabel}
      </span>
    </div>
  );
}

export { IngredientRow };
