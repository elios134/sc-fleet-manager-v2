import { useTranslation } from "react-i18next";
import { type CraftingHubBlueprintItem } from "../types";
import { extractSizeTag } from "../helpers";
import { BlueprintThumb } from "./BlueprintThumb";

function BlueprintRow({
  item,
  owned,
  selected,
  onClick,
}: {
  item: CraftingHubBlueprintItem;
  owned: boolean;
  selected?: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  const sizeTag = extractSizeTag(item.producedItemEntityClass);
  const isFallback = item.displayNameSource === "recordName";
  // Sous-titre = type d'objet (classe brute rendue lisible) + taille éventuelle.
  const prettyCat = item.category
    ? item.category.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2")
    : "";
  const sub = [prettyCat, sizeTag].filter(Boolean).join(" · ");

  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition-colors",
        selected
          ? "border-accent/60 bg-accent/10"
          : "border-white/10 bg-white/[0.02] hover:bg-white/[0.06]",
      ].join(" ")}
    >
      <BlueprintThumb
        imageUrl={item.imageUrl}
        category={item.category}
        name={item.displayName}
        sizeClass="h-9 w-9"
        iconClass="h-4 w-4"
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className={["truncate text-[13px] font-medium text-white", isFallback ? "italic" : ""].join(" ")}
          title={item.displayName}
        >
          {item.displayName}
          {isFallback && <span className="text-white/30"> ?</span>}
        </span>
        {sub && <span className="truncate text-[11px] text-white/45">{sub}</span>}
      </span>
      {owned && (
        <span className="shrink-0 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-emerald-300">
          {t('crafting.owned')}
        </span>
      )}
    </button>
  );
}

export { BlueprintRow };
