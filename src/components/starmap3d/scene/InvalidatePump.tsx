import { useEffect } from "react";
import { useThree } from "@react-three/fiber";

/** En frameloop="demand", pompe invalidate() en rAF pendant ~1.5 s à chaque changement de
    `trigger` (vol caméra, fondus LOD) pour que l'animation se rende. Même pattern que ShipViewer3D. */
export function InvalidatePump({ trigger }: { trigger: unknown }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const pump = () => {
      invalidate();
      if (performance.now() - start < 1500) raf = requestAnimationFrame(pump);
    };
    raf = requestAnimationFrame(pump);
    return () => cancelAnimationFrame(raf);
  }, [trigger, invalidate]);
  return null;
}
