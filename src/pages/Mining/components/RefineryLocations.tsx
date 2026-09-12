// Où raffiner : decks de raffinage groupés par système (chips). Référence statique — la
// méthode choisie se sélectionne au terminal sur place, donc tous les decks conviennent.

import { REFINERIES } from "../../../lib/miningRegistry";

const SYS_COLOR: Record<string, string> = { Stanton: "#5aa9e6", Pyro: "#f59e0b", Nyx: "#12a594" };

export function RefineryLocations({ t }: { t: (k: string, o?: Record<string, unknown>) => string }) {
  const systems = [...new Set(REFINERIES.map((r) => r.system))];
  return (
    <div className="flex flex-col gap-3">
      {systems.map((sys) => {
        const decks = REFINERIES.filter((r) => r.system === sys);
        return (
          <div key={sys}>
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold" style={{ color: SYS_COLOR[sys] ?? "#9ca3af" }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: SYS_COLOR[sys] ?? "#9ca3af" }} />
              {sys.toUpperCase()}
              <span className="font-normal text-white/40">· {t("mining.decksN", { count: decks.length })}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {decks.map((d) => (
                <span
                  key={d.name}
                  className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11.5px] text-white/75"
                >
                  {d.name}
                </span>
              ))}
            </div>
          </div>
        );
      })}
      <p className="text-[10.5px] text-white/30">{t("mining.refineWhereNote")}</p>
    </div>
  );
}
