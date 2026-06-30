import { useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import { useTranslation } from "react-i18next";
import { packCells, containerDim } from "../../lib/cargoPack";

/* Viewer 3D (react-three-fiber) de la grille de soute. Rendu APPROXIMATIF : packing
   maison de nos counts (pas les positions in-game). Caméra orbitale + survol. */

type Cell = { id: number; sizeScu: number; commodity: string | null };

export default function Hold3D({ cells, colorOf }: { cells: Cell[]; colorOf: Map<string, string> }) {
  const { t } = useTranslation();
  const [hover, setHover] = useState<number | null>(null);

  const placed = useMemo(() => packCells(cells, containerDim), [cells]);

  const bounds = useMemo(() => {
    let mx = 0;
    let mz = 0;
    let my = 0;
    for (const p of placed) {
      mx = Math.max(mx, p.gx + p.w);
      mz = Math.max(mz, p.gz + p.d);
      my = Math.max(my, p.h);
    }
    return { mx, mz, my };
  }, [placed]);

  const cx = bounds.mx / 2;
  const cz = bounds.mz / 2;
  const radius = Math.max(bounds.mx, bounds.mz, bounds.my, 4);
  // Remonte la caméra quand la disposition change significativement (recadre).
  const camKey = `${placed.length}-${bounds.mx}-${bounds.mz}`;
  const hovered = hover != null ? placed.find((p) => p.cell.id === hover) : null;

  return (
    <div
      className="overflow-hidden rounded-xl border border-white/10"
      style={{
        height: "clamp(460px, 58vh, 680px)",
        background: "radial-gradient(ellipse at 50% 35%, #15131f 0%, #0a0910 70%, #07060c 100%)",
      }}
    >
      <Canvas key={camKey} camera={{ position: [cx + radius * 1.1, radius * 0.95, cz + radius * 1.35], fov: 42 }}>
        <ambientLight intensity={0.55} />
        <directionalLight position={[radius, radius * 2, radius * 0.5]} intensity={1.1} />
        <directionalLight position={[-radius, radius, -radius]} intensity={0.35} />

        {/* Sol de la soute. */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, -0.02, cz]}>
          <planeGeometry args={[radius * 3, radius * 3]} />
          <meshStandardMaterial color="#0c0b14" roughness={1} />
        </mesh>

        {placed.map((p) => {
          const col = p.cell.commodity ? colorOf.get(p.cell.commodity) ?? "#8a8a92" : null;
          const isHover = hover === p.cell.id;
          return (
            <mesh
              key={p.cell.id}
              position={[p.gx + p.w / 2, p.h / 2, p.gz + p.d / 2]}
              onPointerOver={(e) => {
                e.stopPropagation();
                setHover(p.cell.id);
              }}
              onPointerOut={() => setHover((h) => (h === p.cell.id ? null : h))}
            >
              <boxGeometry args={[p.w * 0.9, p.h * 0.9, p.d * 0.9]} />
              <meshStandardMaterial
                color={col ?? "#2a2a33"}
                transparent
                opacity={col ? 1 : 0.4}
                roughness={0.65}
                metalness={0.1}
                emissive={isHover ? col ?? "#555" : "#000000"}
                emissiveIntensity={isHover ? 0.45 : 0}
              />
            </mesh>
          );
        })}

        {hovered && (
          <Html position={[hovered.gx + hovered.w / 2, hovered.h + 0.5, hovered.gz + hovered.d / 2]} center style={{ pointerEvents: "none" }}>
            <div className="whitespace-nowrap rounded bg-black/80 px-1.5 py-0.5 text-[11px] text-white">
              {hovered.cell.sizeScu} SCU
              {hovered.cell.commodity ? ` · ${hovered.cell.commodity}` : ` · ${t("cargo.grid.freeLabel")}`}
            </div>
          </Html>
        )}

        <OrbitControls
          target={[cx, bounds.my * 0.3, cz]}
          enablePan
          enableDamping
          dampingFactor={0.1}
          minDistance={radius * 0.5}
          maxDistance={radius * 4}
        />
      </Canvas>
    </div>
  );
}
