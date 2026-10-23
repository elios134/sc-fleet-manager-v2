import { useTranslation } from "react-i18next";
import { Box } from "lucide-react";
import { highlight } from "../lib/search";
import type { WhereIs } from "../hooks/useWhereIs";

/** Résultats de la recherche : nom surligné, quantité totale et nombre de lieux. */
export function WhereResults({ w }: { w: WhereIs }) {
  const { t } = useTranslation();
  return (
    <section className="glass flex min-h-0 flex-col rounded-2xl px-4 py-3.5" aria-label={t("inventory.where.results")}>
      <div className="mb-2 flex items-center gap-2">
        <h3 className="flex-1 text-[11px] font-bold uppercase tracking-[0.1em] text-white/55">{t("inventory.where.results")}</h3>
        <span className="font-mono text-[11px] text-white/40">{w.hits.length}</span>
      </div>
      {w.hits.length === 0 ? (
        <p className="py-8 text-center text-[12.5px] text-white/45">{t("inventory.where.none")}</p>
      ) : (
        <ul className="flex flex-col gap-1 overflow-y-auto [scrollbar-width:thin]">
          {w.hits.map((h) => {
            const on = w.hit?.classe === h.classe;
            return (
              <li key={h.classe}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => w.select(h.classe)}
                  className={`flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left ${on ? "border-[var(--accent)]/55 bg-[var(--accent-muted)]" : "border-transparent hover:bg-white/[0.04]"}`}
                >
                  {h.imageUrl ? (
                    <img src={h.imageUrl} alt="" className="h-9 w-9 shrink-0 rounded-lg bg-white/5 object-contain" />
                  ) : (
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/5 text-white/35">
                      <Box className="h-4 w-4" />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <b className="block truncate text-[13px] font-semibold text-white">
                      {highlight(h.nom, w.query).map((p, i) =>
                        p.hit ? (
                          <mark key={i} className="rounded-sm bg-[var(--accent)]/35 text-white">
                            {p.text}
                          </mark>
                        ) : (
                          <span key={i}>{p.text}</span>
                        ),
                      )}
                    </b>
                    <small className="text-[11px] text-white/40">{t("inventory.where.placesCount", { count: h.places.length })}</small>
                  </span>
                  <span className="font-mono text-[12px] text-white/70">×{h.total}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
