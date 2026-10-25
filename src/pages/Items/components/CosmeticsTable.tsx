import { useTranslation } from "react-i18next";
import type { HangarItem } from "../types";
import { cosmeticKind, shipOfTitle } from "../lib/cosmetics";
import { KIND_UI } from "../helpers";
import { CosmeticThumb } from "./CosmeticThumb";

const th = "whitespace-nowrap border-b border-white/[0.06] px-2.5 py-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-white/40";
const td = "border-b border-white/[0.06] px-2.5 py-1.5 text-[11.5px] text-white/55";

/** Liste des objets du hangar : clic sur une ligne → fiche à droite. */
export function CosmeticsTable({ items, selectedId, onSelect }: { items: HangarItem[]; selectedId: number | null; onSelect: (it: HangarItem) => void }) {
  const { t } = useTranslation();
  return (
    <table className="w-full border-collapse text-left">
      <thead>
        <tr>
          <th className={th}>{t("items.colItem")}</th>
          <th className={th}>{t("items.colKind")}</th>
          <th className={th}>{t("items.colFor")}</th>
          <th className={th}>{t("items.colPack")}</th>
        </tr>
      </thead>
      <tbody>
        {items.map((it) => {
          const sel = it.id === selectedId;
          const kind = KIND_UI[cosmeticKind(it)];
          return (
            <tr
              key={it.id}
              onClick={() => onSelect(it)}
              aria-selected={sel}
              className={`cursor-pointer transition-colors ${sel ? "bg-[var(--accent-muted)] shadow-[inset_3px_0_0_var(--accent)]" : "hover:bg-white/[0.03]"}`}
            >
              <td className="border-b border-white/[0.06] px-2.5 py-1.5">
                <span className="flex min-w-0 items-center gap-2.5">
                  <CosmeticThumb imageUrl={it.imageUrl} className="h-9 w-9" glyph={16} />
                  <span className="truncate text-[13px] font-semibold text-white">{it.title}</span>
                </span>
              </td>
              <td className={td}>
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  <kind.Icon className="h-3.5 w-3.5 text-[var(--accent)]" /> {t(kind.labelKey)}
                </span>
              </td>
              <td className={td}>{shipOfTitle(it.title) ?? "—"}</td>
              <td className={`${td} max-w-[260px] truncate`}>{it.pledgeName ?? "—"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
