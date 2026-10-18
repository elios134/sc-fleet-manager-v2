import { useTranslation } from "react-i18next";
import { Globe, Orbit, User } from "lucide-react";
import type { ScopeTree } from "../aggregate";

export type Scope = { mode: "moi" } | { mode: "place"; system: string; planet: string; locId: string };

/* Arbre de navigation : « Sur moi » épinglé, puis Système › Planète/Lune › Lieu (nœuds non vides). */
export function ScopeRail({ tree, scope, onChange }: { tree: ScopeTree; scope: Scope; onChange: (s: Scope) => void }) {
  const { t } = useTranslation();
  const node = "flex w-full items-center gap-2 rounded-[9px] px-2 py-1.5 text-left text-[13px]";
  return (
    <nav aria-label={t("inventory.whereTitle")} className="glass flex flex-col gap-1 rounded-2xl p-3 lg:sticky lg:top-0">
      <button
        type="button"
        onClick={() => onChange({ mode: "moi" })}
        className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left ${scope.mode === "moi" ? "border-[var(--amber)]/60 bg-[var(--amber-muted)]" : "border-[var(--amber)]/30 hover:bg-white/[0.05]"}`}
      >
        <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-[var(--amber)]/25 text-amber-200"><User className="h-4 w-4" /></span>
        <span className="flex-1 text-[13.5px] font-semibold text-white">{t("inventory.onMe")}</span>
        <span className="text-lg font-bold tabular-nums text-amber-200">{tree.moiCount}</span>
      </button>

      {tree.systems.length > 0 && <p className="px-2 pb-1 pt-3 text-[10px] font-bold uppercase tracking-[0.1em] text-white/40">{t("inventory.storedIn")}</p>}
      {tree.systems.map((sys) => (
        <div key={sys.name}>
          <p className={`${node} font-bold text-white`}><Globe className="h-4 w-4 text-white/50" />{sys.name}<span className="ml-auto text-[11.5px] text-white/40 tabular-nums">{sys.count}</span></p>
          {(tree.planetsBySystem[sys.name] ?? []).map((pl) => (
            <div key={pl.name}>
              <p className={`${node} pl-6 text-white/65`}><Orbit className="h-4 w-4 text-white/40" />{pl.name}<span className="ml-auto text-[11.5px] text-white/40 tabular-nums">{pl.count}</span></p>
              {(tree.placesByPlanet[pl.name] ?? []).map((pc) => {
                const on = scope.mode === "place" && scope.locId === pc.locId;
                return (
                  <button
                    key={pc.locId}
                    type="button"
                    onClick={() => onChange({ mode: "place", system: sys.name, planet: pl.name, locId: pc.locId })}
                    className={`${node} pl-10 ${on ? "bg-[var(--accent)]/20 text-white shadow-[inset_2px_0_0_var(--accent)]" : "text-white/65 hover:bg-white/[0.05]"}`}
                  >
                    <span className="min-w-0 flex-1 truncate">{pc.name}</span>
                    <span className="text-[11.5px] text-white/40 tabular-nums">{pc.count}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      ))}
      <p className="mt-2 border-t border-white/10 px-2 pt-2.5 text-[11px] leading-relaxed text-white/40">{t("inventory.railNote")}</p>
    </nav>
  );
}
