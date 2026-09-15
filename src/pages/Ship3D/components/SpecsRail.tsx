import type { SpecItem } from "../types";

interface Props {
  items: SpecItem[];
}

/* Rail de specs (droite du viewer) : tuiles verticales équipage / cargo / dimensions.
   Chaque tuile n'apparaît que si la donnée existe (pas de « — »). */
export default function SpecsRail({ items }: Props) {
  if (items.length === 0) return null;
  return (
    <div className="pointer-events-none absolute right-5 top-1/2 z-10 w-[168px] -translate-y-1/2 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] p-1.5 backdrop-blur-xl">
      {items.map((s, i) => (
        <div key={s.k} className={i > 0 ? "border-t border-white/[0.06] px-3 py-2.5" : "px-3 py-2.5"}>
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-white/40">
            {s.icon}
            {s.k}
          </div>
          <div className="mt-1 text-[19px] font-bold tabular-nums leading-none text-white">
            {s.v}
            {s.u && <span className="ml-1 text-[11px] font-medium text-white/50">{s.u}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
