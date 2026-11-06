import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { Box, Crosshair, Cpu, Pill, Shield, Shirt, type LucideIcon } from "lucide-react";
import { ItemThumb } from "../../../components/catalogue/ItemThumb";
import { vuLe, type InvRow } from "../aggregate";
import { highlight } from "../lib/search";

const ICON: Record<string, LucideIcon> = { Armes: Crosshair, Armure: Shield, Vêtements: Shirt, Consommables: Pill, Composants: Cpu, Divers: Box };
const th = "whitespace-nowrap border-b border-white/[0.06] px-2.5 py-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-white/40";
const td = "border-b border-white/[0.06] px-2.5 py-1.5 text-[12px] text-white/60";

/** Objets du lieu, groupés par catégorie avec sous-total. Une recherche (`query`) montre les objets
 *  de tous les lieux : à plat, nom surligné et nombre de lieux. Clic sur une ligne → fiche. */
export function InventoryTable({ rows, selected, onSelect, query }: { rows: InvRow[]; selected: string | null; onSelect: (classe: string) => void; query: string | null }) {
  const { t } = useTranslation();
  const groups: { cat: string; items: InvRow[] }[] = [];
  for (const r of rows) {
    const cat = query == null ? r.categorie : "";
    const last = groups[groups.length - 1];
    if (last && last.cat === cat) last.items.push(r);
    else groups.push({ cat, items: [r] });
  }
  return (
    <table className="w-full border-collapse text-left">
      <thead>
        <tr>
          <th className={th}>{t("inventory.colItem")}</th>
          <th className={th}>{t("inventory.colCategory")}</th>
          <th className={`${th} text-right`}>{t("inventory.colQty")}</th>
          <th className={`${th} text-right`}>{t("inventory.colSeen")}</th>
        </tr>
      </thead>
      <tbody>
        {groups.map((g) => (
          <Fragment key={g.cat}>
            {g.cat && (
              <tr>
                <td colSpan={2} className="px-2.5 pb-1 pt-3 text-[11px] font-bold uppercase tracking-[0.08em] text-white/55">{g.cat}</td>
                <td className="px-2.5 pb-1 pt-3 text-right text-[11px] tabular-nums text-white/40">{g.items.reduce((n, i) => n + i.qte, 0)}</td>
                <td />
              </tr>
            )}
            {g.items.map((r) => {
              const on = r.classe === selected;
              return (
                <tr
                  key={r.classe}
                  onClick={() => onSelect(r.classe)}
                  aria-selected={on}
                  className={`cursor-pointer transition-colors ${on ? "bg-[var(--accent-muted)] shadow-[inset_3px_0_0_var(--accent)]" : "hover:bg-white/[0.03]"}`}
                >
                  <td className="border-b border-white/[0.06] px-2.5 py-1.5">
                    <span className="flex min-w-0 items-center gap-2.5">
                      <ItemThumb imageUrl={r.imageUrl} icon={ICON[r.categorie] ?? Box} size={40} />
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-semibold text-white">
                          {query == null
                            ? r.nom
                            : highlight(r.nom, query).map((p, i) =>
                                p.hit ? <mark key={i} className="rounded-sm bg-[var(--accent)]/35 text-white">{p.text}</mark> : <span key={i}>{p.text}</span>,
                              )}
                        </span>
                        {r.placeCount != null && <span className="block text-[11px] text-white/40">{t("inventory.where.placesCount", { count: r.placeCount })}</span>}
                      </span>
                    </span>
                  </td>
                  <td className={td}>{r.categorie}</td>
                  <td className={`${td} text-right text-[13px] font-semibold tabular-nums text-white/85`}>{r.qte}</td>
                  <td className={`${td} text-right tabular-nums`}>{vuLe(r.vu)}</td>
                </tr>
              );
            })}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}
