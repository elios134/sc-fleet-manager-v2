import { Html, Line } from "@react-three/drei";
import type { Vec3 } from "../placement";

/** Chemin de l'itinéraire dans la scène : pointillés entre les étapes visibles + pastilles
 *  numérotées (D = départ). Coordonnées = positions de rendu (layout), pas les km réels. */
export function ItineraryPath({ points }: { points: { pos: Vec3; label: string }[] }) {
  if (points.length === 0) return null;
  return (
    <>
      {points.length > 1 && (
        <Line points={points.map((p) => p.pos)} color="#818cf8" lineWidth={2} dashed dashSize={3} gapSize={2.4} transparent opacity={0.9} />
      )}
      {points.map((p, i) => (
        <Html key={`${p.label}-${i}`} position={p.pos} center distanceFactor={60} style={{ pointerEvents: "none" }} zIndexRange={[20, 0]}>
          <span
            className={`-mt-9 grid h-6 min-w-6 place-items-center rounded-full px-1 font-mono text-[12px] font-bold shadow ${
              p.label === "D" ? "bg-emerald-400 text-emerald-950" : "bg-[var(--accent)] text-white"
            }`}
          >
            {p.label}
          </span>
        </Html>
      ))}
    </>
  );
}
