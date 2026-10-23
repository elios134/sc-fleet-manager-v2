import { useMemo } from "react";
import { layoutSystem } from "../../../components/starmap3d/layout";
import { safeName, type StarmapBodyItem } from "../../../components/starmap3d/starmapData";

const W = 400;
const H = 200;

/** Mini-carte du système vue de dessus : étoile, planètes, et les lieux de l'objet mis en avant. */
export function SystemMiniMap({ bodies, systemId, marked }: { bodies: StarmapBodyItem[]; systemId: string; marked: Map<string, number> }) {
  const placed = useMemo(() => layoutSystem(bodies, systemId).filter((p) => p.kind === "star" || p.kind === "planet" || marked.has(p.body.id)), [bodies, systemId, marked]);
  const extent = Math.max(1, ...placed.map((p) => Math.max(Math.abs(p.pos[0]), Math.abs(p.pos[2]))));
  const sx = (W / 2 - 24) / extent;
  const sy = (H / 2 - 18) / extent;
  const at = (p: (typeof placed)[number]) => [W / 2 + p.pos[0] * sx, H / 2 + p.pos[2] * sy] as const;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-[200px] w-full rounded-xl border border-white/10 bg-black/40" role="img" aria-label={systemId}>
      {placed.map((p) => {
        const [x, y] = at(p);
        const n = marked.get(p.body.id);
        if (p.kind === "star") return <circle key={p.body.id} cx={x} cy={y} r={6} className="fill-amber-200" />;
        return (
          <g key={p.body.id}>
            <circle cx={x} cy={y} r={n != null ? 5 : 3} className={n != null ? "fill-[var(--accent)]" : "fill-white/35"} />
            {n != null && <circle cx={x} cy={y} r={10} className="fill-none stroke-[var(--accent)]" strokeWidth={1.5} />}
            <text x={x} y={y - 13} textAnchor="middle" className={n != null ? "fill-white text-[11px] font-semibold" : "fill-white/40 text-[9.5px]"}>
              {safeName(p.body)}
              {n != null ? ` ×${n}` : ""}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
