import { useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Stars, Html } from "@react-three/drei";
import {
  buildSystemLayout,
  bodyColor,
  TILT,
  type StarmapBodyItem,
  type BodyLayout,
} from "./StarmapCanvas";

/* ──────────────────────────────────────────────────────────────────────────
 * Carte galactique 3D (Phase 3) — REPREND la logique de placement de la 2D :
 * on appelle le même `buildSystemLayout` (positions = logRadius de la distance
 * réelle posX/Y/Z, angle = atan2(posY,posX), rattachement parent par wikiUuid),
 * puis on lève les coordonnées écran (wx, wy) dans le plan orbital 3D en
 * « dé-tiltant » wy (wy = …·TILT → z = wy / TILT). Le placement est donc
 * identique à la 2D, vu en perspective.
 * ────────────────────────────────────────────────────────────────────────── */

const SCALE = 0.1; // px (layout 2D) → unités 3D

// (wx, wy) 2D → position 3D dans le plan orbital (y = 0). wy est aplati par TILT
// côté 2D : on le restaure pour retrouver la vraie distance dans le plan.
function to3D(wx: number, wy: number): [number, number, number] {
  return [wx * SCALE, 0, (wy / TILT) * SCALE];
}

function radiusOf(rv: number, isStar: boolean): number {
  return Math.max(isStar ? 1.4 : 0.35, rv * (isStar ? 0.18 : 0.14));
}

type Node = {
  body: StarmapBodyItem;
  pos: [number, number, number];
  r: number;
  color: string;
  isStar: boolean;
};

function buildNodes(bodies: StarmapBodyItem[], system: string): { nodes: Node[]; rings: number[] } {
  const inSystem = bodies.filter((b) => b.systemName === system);
  const sys = buildSystemLayout(inSystem, system);
  const nodes: Node[] = [];
  const rings: number[] = [];
  const add = (bl: BodyLayout, isStar = false) =>
    nodes.push({
      body: bl.body,
      pos: to3D(bl.wx, bl.wy),
      r: radiusOf(bl.rv, isStar),
      color: bodyColor(bl.body),
      isStar,
    });

  if (sys.star) add(sys.star, true);
  for (const pl of sys.planets) {
    add(pl);
    rings.push(pl.ring * SCALE);
    for (const ch of pl.children) add(ch); // lunes, POI, Lagrange (mêmes positions que la 2D)
  }
  for (const m of sys.moons) add(m); // lunes orphelines
  for (const gw of sys.gateways) add(gw); // points de saut / stations stellaires
  return { nodes, rings };
}

function OrbitRing({ radius }: { radius: number }) {
  const points = useMemo(() => {
    const pts: number[] = [];
    const seg = 128;
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      pts.push(Math.cos(a) * radius, 0, Math.sin(a) * radius);
    }
    return new Float32Array(pts);
  }, [radius]);
  return (
    <line>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[points, 3]} />
      </bufferGeometry>
      <lineBasicMaterial color="#ffffff" transparent opacity={0.08} />
    </line>
  );
}

function BodyMesh({
  node,
  selected,
  onSelect,
}: {
  node: Node;
  selected: boolean;
  onSelect: (b: StarmapBodyItem) => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <group position={node.pos}>
      <mesh
        onClick={(e) => {
          e.stopPropagation();
          onSelect(node.body);
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={() => setHovered(false)}
      >
        <sphereGeometry args={[node.r, 32, 32]} />
        {node.isStar ? (
          <meshBasicMaterial color={node.color} />
        ) : (
          <meshStandardMaterial
            color={node.color}
            emissive={node.color}
            emissiveIntensity={hovered || selected ? 0.7 : 0.18}
            roughness={0.65}
          />
        )}
      </mesh>
      {node.isStar && <pointLight intensity={2.4} distance={400} decay={0} />}
      {(hovered || selected) && (
        <Html center distanceFactor={50} style={{ pointerEvents: "none" }}>
          <div className="whitespace-nowrap rounded bg-black/80 px-1.5 py-0.5 text-[11px] text-white">
            {node.body.name}
          </div>
        </Html>
      )}
    </group>
  );
}

export default function Starmap3D({
  bodies,
  system,
}: {
  bodies: StarmapBodyItem[];
  system: string;
}) {
  const [selected, setSelected] = useState<StarmapBodyItem | null>(null);
  const { nodes, rings } = useMemo(() => buildNodes(bodies, system), [bodies, system]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl border border-white/10 bg-black">
      <Canvas camera={{ position: [0, 38, 56], fov: 50 }} onPointerMissed={() => setSelected(null)}>
        <ambientLight intensity={0.4} />
        <Stars radius={400} depth={80} count={5000} factor={4} fade speed={0.4} />
        {rings.map((r, i) => (
          <OrbitRing key={i} radius={r} />
        ))}
        {nodes.map((n) => (
          <BodyMesh
            key={n.body.id}
            node={n}
            selected={selected?.id === n.body.id}
            onSelect={setSelected}
          />
        ))}
        <OrbitControls enablePan enableDamping dampingFactor={0.1} minDistance={4} maxDistance={320} />
      </Canvas>

      {selected && (
        <div className="absolute left-3 top-3 max-w-xs rounded-xl border border-white/15 bg-[#0a0a0f]/85 p-3 backdrop-blur">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: bodyColor(selected) }} />
            <span className="text-sm font-semibold text-white">{selected.name}</span>
          </div>
          <div className="mt-1 text-[11px] uppercase tracking-wider text-white/40">
            {selected.navIcon} · {selected.systemName}
          </div>
          {selected.description && (
            <p className="mt-2 line-clamp-4 text-xs text-white/60">{selected.description}</p>
          )}
        </div>
      )}
    </div>
  );
}
