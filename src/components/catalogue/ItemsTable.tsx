import { useTranslation } from "react-i18next";
import { catLabel } from "../../lib/catalogLabels";
import { fmt, itemIcon } from "./shared";
import { ItemThumb } from "./ItemThumb";
import type { CatalogItem } from "./itemsView";

const th = "whitespace-nowrap border-b border-white/[0.06] px-2.5 py-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-white/40";
const td = "border-b border-white/[0.06] px-2.5 py-1.5";

/** Liste des articles (vue « Par article ») : clic sur une ligne → fiche à droite. */
export function ItemsTable({
  items,
  selectedId,
  onSelect,
  thumbUrl,
}: {
  items: CatalogItem[];
  selectedId: number | null;
  onSelect: (it: CatalogItem) => void;
  thumbUrl: (it: CatalogItem) => string | null;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  return (
    <table className="w-full border-collapse text-left">
      <thead>
        <tr>
          <th className={th}>{t("catalogue.colItem")}</th>
          <th className={th}>{t("catalogue.colCategory")}</th>
          <th className={th}>{t("catalogue.colMaker")}</th>
          <th className={`${th} text-right`}>{t("catalogue.colPoints")}</th>
          <th className={`${th} text-right`}>{t("catalogue.colMinPrice")}</th>
        </tr>
      </thead>
      <tbody>
        {items.map((it) => {
          const sel = it.id === selectedId;
          return (
            <tr
              key={it.id}
              onClick={() => onSelect(it)}
              aria-selected={sel}
              className={`cursor-pointer transition-colors ${sel ? "bg-[var(--accent-muted)] shadow-[inset_3px_0_0_var(--accent)]" : "hover:bg-white/[0.03]"}`}
            >
              <td className={td}>
                <span className="flex min-w-0 items-center gap-2.5">
                  <ItemThumb imageUrl={thumbUrl(it)} icon={itemIcon(it.section, it.category)} size={36} />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-semibold text-white">{it.name}</span>
                    <span className="block truncate text-[11px] text-white/45">{catLabel(it.section, lang)}</span>
                  </span>
                </span>
              </td>
              <td className={`${td} text-[11.5px] text-white/55`}>{it.category ? catLabel(it.category, lang) : "—"}</td>
              <td className={`${td} text-[11.5px] text-white/55`}>{it.companyName ?? "—"}</td>
              <td className={`${td} text-right text-[12px] tabular-nums text-white/75`}>{it.sellPoints}</td>
              <td className={`${td} whitespace-nowrap text-right tabular-nums`}>
                <span className="text-[13px] font-bold text-emerald-400">{fmt(it.minPrice)}</span>
                <span className="ml-1 text-[10px] text-white/40">{t("catalogue.aUEC")}</span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
