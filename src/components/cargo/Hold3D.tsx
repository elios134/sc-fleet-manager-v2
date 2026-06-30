import { useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Html, Edges } from "@react-three/drei";
import { useTranslation } from "react-i18next";
import { packCells, containerDim } from "../../lib/cargoPack";
import type { BayFrame } from "../../lib/cargoBays";

/* Viewer 3D (react-three-fiber) de la grille de soute.
   • Mode BAIES (frames fournis) : vraies grilles SC Wiki aux bonnes dimensions, conteneurs
     packés DANS chaque baie (placement optimisé maison — pas le placement exact in-game).
   • Mode REPLI (sans frames) : packing maison de la composition Ratjack sur un seul sol.
   1 cellule = 1 unité de scène (= 1,25 m en jeu). Caméra orbitale + survol. */

type Placement = { x: number; y: number; z: number; w: number; h: number; d: number };
type Cell = { id: number; sizeScu: number; commodity: string | null; pos?: Placement; bay?: number };
type Box = { cell: Cell; gx: number; gy: number; gz: number; w: number; h: number; d: number };

export default function Hold3D({
  cells,
  colorOf,
  frames,
}: {
  cells: Cell[];
  colorOf: Map<string, string>;
  frames?: BayFrame[];
}) {
  const { t } = useTranslation();
  const [hover, setHover] = useState<number | null>(null);

  // Boîtes positionnées : mode baies = positions Wiki packées ; sinon packing au sol.
  const placed = useMemo<Box[]>(() => {
    if (frames && frames.length > 0) {
      return cells
        .filter((c) => c.pos)
        .map((c) => ({ cell: c, gx: c.pos!.x, gy: c.pos!.y, gz: c.pos!.z, w: c.pos!.w, h: c.pos!.h, d: c.pos!.d }));
    }
    return packCells(cells, containerDim).map((p) => ({ ...p, gy: 0 }));
  }, [cells, frames]);

  const bounds = useMemo(() => {
    let mx = 0;
    let mz = 0;
    let my = 0;
    if (frames && frames.length > 0) {
      for (const f of frames) {
        mx = Math.max(mx, f.ox + f.cols);
        mz = Math.max(mz, f.oz + f.rows);
        my = Math.max(my, f.layers);
      }
    } else {
      for (const p of placed) {
        mx = Math.max(mx, p.gx + p.w);
        mz = Math.max(mz, p.gz + p.d);
        my = Math.max(my, p.gy + p.h);
      }
    }
    return { mx, mz, my };
  }, [placed, frames]);

  const cx = bounds.mx / 2;
  const cz = bounds.mz / 2;
  const radius = Math.max(bounds.mx, bounds.mz, bounds.my, 4);
  // Remonte la caméra quand la disposition change significativement (recadre).
  const camKey = `${placed.length}-${bounds.mx}-${bounds.mz}-${frames?.length ?? 0}`;
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

        {/* Cadres des vraies baies : ARÊTES SEULES (pas de faces → ne masque jamais
            les conteneurs, aucun tri transparent → aucun clignotement à l'orbite). */}
        {frames?.map((f) => (
          <mesh key={`bay-${f.index}`} position={[f.ox + f.cols / 2, f.layers / 2, f.oz + f.rows / 2]}>
            <boxGeometry args={[f.cols, f.layers, f.rows]} />
            <meshBasicMaterial visible={false} />
            <Edges threshold={15} color={f.external ? "#5f9fc0" : "#46465a"} />
          </mesh>
        ))}

        {placed.map((p) => {
          const col = p.cell.commodity ? colorOf.get(p.cell.commodity) ?? "#8a8a92" : null;
          const isHover = hover === p.cell.id;
          return (
            <mesh
              key={p.cell.id}
              position={[p.gx + p.w / 2, p.gy + p.h / 2, p.gz + p.d / 2]}
              onPointerOver={(e) => {
                e.stopPropagation();
                setHover(p.cell.id);
              }}
              onPointerOut={() => setHover((h) => (h === p.cell.id ? null : h))}
            >
              <boxGeometry args={[p.w * 0.9, p.h * 0.9, p.d * 0.9]} />
              {/* Tout OPAQUE : aucun tri transparent → rien ne disparaît à l'orbite.
                  Vide = gris neutre, occupé = couleur de la marchandise. */}
              <meshStandardMaterial
                color={col ?? "#3a3a47"}
                roughness={0.6}
                metalness={0.1}
                emissive={isHover ? col ?? "#666" : "#000000"}
                emissiveIntensity={isHover ? 0.5 : 0}
              />
            </mesh>
          );
        })}

        {hovered && (
          <Html position={[hovered.gx + hovered.w / 2, hovered.gy + hovered.h + 0.5, hovered.gz + hovered.d / 2]} center style={{ pointerEvents: "none" }}>
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
