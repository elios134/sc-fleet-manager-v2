import { useTranslation } from "react-i18next";
import { Search, X } from "lucide-react";
import type { InvFilter } from "../lib/search";
import type { WhereIs } from "../hooks/useWhereIs";

const FILTERS: InvFilter[] = ["all", "weapons", "armor", "tools"];

/** Recherche « Où est mon… ? » : nom de l'objet, catégorie, recherches récentes. */
export function WhereSearchBar({ w }: { w: WhereIs }) {
  const { t } = useTranslation();
  return (
    <div className="glass flex shrink-0 flex-col gap-2 rounded-2xl px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex min-w-[260px] flex-1 items-center gap-2 rounded-[10px] border border-white/16 bg-white/[0.03] px-3 py-2">
          <Search className="h-4 w-4 text-white/40" />
          <input
            value={w.query}
            onChange={(e) => w.setQuery(e.target.value)}
            placeholder={t("inventory.where.placeholder")}
            aria-label={t("inventory.where.title")}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-white outline-none placeholder:text-white/40"
          />
          {w.query && (
            <button type="button" onClick={() => w.setQuery("")} aria-label={t("inventory.where.clear")} className="rounded p-0.5 text-white/40 hover:text-white">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </label>
        <div role="group" aria-label={t("inventory.where.kind")} className="flex rounded-full border border-white/10 bg-white/5 p-0.5 text-[11.5px] font-semibold">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={w.filter === f}
              onClick={() => w.setFilter(f)}
              className={`rounded-full px-3 py-1 ${w.filter === f ? "bg-[var(--accent)] text-white" : "text-white/55 hover:text-white"}`}
            >
              {t(`inventory.where.filter.${f}`)}
            </button>
          ))}
        </div>
      </div>
      {w.recent.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="text-white/40">{t("inventory.where.recent")}</span>
          {w.recent.map((r) => (
            <button key={r} type="button" onClick={() => w.setQuery(r)} className="rounded-full border border-white/12 bg-white/[0.04] px-2.5 py-0.5 text-white/70 hover:bg-white/10">
              {r}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
