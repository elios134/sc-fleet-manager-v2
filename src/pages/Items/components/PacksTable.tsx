import { useTranslation } from "react-i18next";
import { cosmeticKind, type CosmeticKind, type Pack } from "../lib/cosmetics";
import { KIND_UI, fmtPackValue } from "../helpers";
import { CosmeticThumb } from "./CosmeticThumb";

const th = "whitespace-nowrap border-b border-white/[0.06] px-2.5 py-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-white/40";
const td = "border-b border-white/[0.06] px-2.5 py-1.5 text-[12px] text-white/60";

/** Liste des packs du hangar : vignette, nom, contenu (nombre d'objets et types), valeur, date.
 *  Clic sur une ligne → fenêtre du pack (ou de l'objet s'il est seul). */
export function PacksTable({ packs, onOpen }: { packs: Pack[]; onOpen: (p: Pack) => void }) {
  const { t } = useTranslation();
  return (
    <table className="w-full border-collapse text-left">
      <thead>
        <tr>
          <th className={th}>{t("items.colPack")}</th>
          <th className={th}>{t("items.colContent")}</th>
          <th className={`${th} text-right`}>{t("items.colValue")}</th>
          <th className={th}>{t("items.colDate")}</th>
        </tr>
      </thead>
      <tbody>
        {packs.map((p) => {
          const kinds: CosmeticKind[] = [...new Set(p.items.map(cosmeticKind))];
          const single = p.items.length === 1 ? p.items[0]! : null;
          return (
            <tr key={p.id} onClick={() => onOpen(p)} className="cursor-pointer transition-colors hover:bg-white/[0.03]">
              <td className="border-b border-white/[0.06] px-2.5 py-1.5">
                <span className="flex min-w-0 items-center gap-2.5">
                  <CosmeticThumb imageUrl={p.items.find((it) => it.imageUrl)?.imageUrl ?? null} className="h-10 w-10" glyph={16} />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-semibold text-white">{single ? single.title : p.name}</span>
                    {single && <span className="block truncate text-[11px] text-white/45">{p.name}</span>}
                  </span>
                </span>
              </td>
              <td className={td}>
                <span className="inline-flex items-center gap-2 whitespace-nowrap">
                  {!single && <span className="rounded-full bg-[var(--accent)] px-2 py-px text-[10.5px] font-bold tabular-nums text-white">{t("items.itemsCount", { n: p.items.length })}</span>}
                  {kinds.map((k) => {
                    const { Icon, labelKey } = KIND_UI[k];
                    return <Icon key={k} className="h-3.5 w-3.5 text-[var(--accent)]" aria-label={t(labelKey)} />;
                  })}
                  {single && t(KIND_UI[kinds[0]!].labelKey)}
                </span>
              </td>
              <td className={`${td} text-right tabular-nums text-white/80`}>{fmtPackValue(p.valueUsd)}</td>
              <td className={`${td} whitespace-nowrap`}>{p.createdDate ?? "—"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
