import { useTranslation } from "react-i18next";
import { Box } from "lucide-react";
import { vuLe, type InvRow } from "../aggregate";


/* Tuiles « image d'abord », groupées par catégorie (rows déjà triées par catégorie). */
export function ItemTiles({ rows }: { rows: InvRow[] }) {
  const { t } = useTranslation();
  if (rows.length === 0) return <p className="px-4 py-10 text-center text-sm text-white/40">{t("inventory.empty")}</p>;
  const groups: { cat: string; items: InvRow[] }[] = [];
  for (const r of rows) {
    const last = groups[groups.length - 1];
    if (last && last.cat === r.categorie) last.items.push(r);
    else groups.push({ cat: r.categorie, items: [r] });
  }
  return (
    <div className="flex flex-col gap-3 pb-2">
      {groups.map((g) => (
        <section key={g.cat} className="flex flex-col gap-3">
          <div className="flex items-center gap-2.5">
            <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-white/55">{g.cat}</h3>
            <span className="h-px flex-1 bg-white/10" />
            <span className="text-[11px] tabular-nums text-white/40">{g.items.reduce((n, i) => n + i.qte, 0)}</span>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-3">
            {g.items.map((r) => (
              <article key={r.classe} className="glass flex flex-col overflow-hidden rounded-[14px]">
                <div className="relative grid h-32 place-items-center border-b border-white/10 bg-[radial-gradient(ellipse_at_50%_40%,rgba(99,102,241,0.14),rgba(255,255,255,0.02)_70%)]">
                  {r.imageUrl ? (
                    <img src={r.imageUrl} alt="" loading="lazy" className="max-h-[104px] max-w-[82%] object-contain drop-shadow-[0_6px_14px_rgba(0,0,0,0.5)]" />
                  ) : (
                    <Box className="h-11 w-11 text-white/30" strokeWidth={1.4} />
                  )}
                  <span className="absolute right-2 top-2 min-w-[30px] rounded-full border border-white/15 bg-[#0a0a0f]/85 px-2 py-0.5 text-center text-[13px] font-extrabold tabular-nums">{r.qte}</span>
                </div>
                <div className="flex flex-col gap-1.5 px-3 pb-3 pt-2.5">
                  <span className="line-clamp-2 min-h-[2.6em] text-[13.5px] font-semibold leading-tight text-white">{r.nom}</span>
                  <span className="flex items-center justify-between text-[11px] text-white/40">
                    <span className="rounded-full border border-white/10 px-2 py-0.5 font-semibold text-white/60">{r.categorie}</span>
                    <span className="tabular-nums">{vuLe(r.vu)}</span>
                  </span>
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
