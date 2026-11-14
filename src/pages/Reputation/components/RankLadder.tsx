import type { RankDef } from "../../../lib/reputation";

/** Échelle des rangs : un segment par rang, le rang en cours rempli au prorata ; objectif en doré. */
export function RankLadder({ ranks, rankIndex, pct }: { ranks: RankDef[]; rankIndex: number; pct: number }) {
  const cols = { gridTemplateColumns: `repeat(${ranks.length}, minmax(0, 1fr))` };
  return (
    <div>
      <div className="grid gap-1" style={cols}>
        {ranks.map((r, i) => (
          <div key={r.name} className="h-2 overflow-hidden rounded-full bg-white/[0.08]">
            <i
              className={`block h-full ${i < rankIndex ? "bg-[var(--accent)]/70" : "bg-[var(--accent)]"}`}
              style={{ width: `${i < rankIndex ? 100 : i === rankIndex ? Math.max(pct, 3) : 0}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 grid gap-1" style={cols}>
        {ranks.map((r, i) => (
          <span
            key={r.name}
            title={r.name}
            className={`truncate text-[10.5px] ${i === rankIndex ? "font-bold text-white" : i === rankIndex + 1 ? "font-bold text-[var(--gold)]" : "text-white/40"}`}
          >
            {r.name.replace(/ Contractor$/, "")}
          </span>
        ))}
      </div>
    </div>
  );
}
