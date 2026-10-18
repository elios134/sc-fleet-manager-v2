import { useTranslation } from "react-i18next";
import { Box, Crosshair, Shield, Shirt, Pill, Cpu, type LucideIcon } from "lucide-react";
import { ItemThumb } from "../../../components/catalogue/ItemThumb";
import type { InvRow } from "../aggregate";

const ICON: Record<string, LucideIcon> = {
  Armes: Crosshair,
  Armure: Shield,
  Vêtements: Shirt,
  Consommables: Pill,
  Composants: Cpu,
  Divers: Box,
};

function vuLe(vu: number): string {
  if (!vu) return "—";
  const d = new Date(vu * 1000);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function InventoryList({ rows, query }: { rows: InvRow[]; query: string }) {
  const { t } = useTranslation();
  const q = query.trim().toLowerCase();
  const filtered = q ? rows.filter((r) => r.nom.toLowerCase().includes(q)) : rows;
  if (filtered.length === 0) {
    return <div className="px-4 py-10 text-center text-sm text-white/40">{t("inventory.empty")}</div>;
  }
  // rows déjà triées par catégorie (aggregate) : on regroupe en préservant l'ordre.
  const groups: { cat: string; items: InvRow[] }[] = [];
  for (const r of filtered) {
    const last = groups[groups.length - 1];
    if (last && last.cat === r.categorie) last.items.push(r);
    else groups.push({ cat: r.categorie, items: [r] });
  }
  return (
    <div className="pb-2">
      {groups.map((g) => (
        <div key={g.cat}>
          <div className="flex items-center gap-3 px-4 pb-1 pt-3">
            <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-white/55">{g.cat}</h3>
            <span className="h-px flex-1 bg-white/10" />
            <span className="text-[11px] tabular-nums text-white/40">{g.items.reduce((n, i) => n + i.qte, 0)}</span>
          </div>
          {g.items.map((r) => (
            <div key={r.classe} className="flex items-center gap-[15px] px-4 py-[11px] hover:bg-white/[0.05]">
              <ItemThumb imageUrl={r.imageUrl} icon={ICON[g.cat] ?? Box} size={64} />
              <span className="w-9 shrink-0 text-right text-[20px] font-bold tabular-nums">{r.qte}</span>
              <span className="min-w-0 flex-1 truncate text-[15px]">{r.nom}</span>
              <span className="shrink-0 rounded-md border border-white/10 px-[7px] py-0.5 text-[10px] font-semibold uppercase tracking-[0.04em] text-white/55">
                {g.cat}
              </span>
              <span className="w-12 shrink-0 text-right text-[11.5px] tabular-nums text-white/40">{vuLe(r.vu)}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
