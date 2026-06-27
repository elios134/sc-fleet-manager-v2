import { useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Stars, Html } from "@react-three/drei";
import type { StarmapBodyItem } from "./StarmapCanvas";

/* ──────────────────────────────────────────────────────────────────────────
 * Carte galactique 3D (Phase 3) — vue Three.js (react-three-fiber) d'un système :
 * étoile au centre, planètes sur des orbites, lunes autour de leur planète, POI
 * (stations / avant-postes / zones d'atterrissage / Lagrange) en marqueurs.
 * Layout schématique (robuste quelles que soient les positions brutes), navigation
 * libre (OrbitControls), clic sur un corps → sélection. Chargé en lazy par la page.
 * ────────────────────────────────────────────────────────────────────────── */

const COLOR: Record<string, string> = {
  Star: "#ffcf6a",
  Planet: "#5aa9e6",
  Moon: "#9ca3af",
  Lagrange: "#a78bfa",
  Station: "#34d399",
  Outpost: "#f59e0b",
  LandingZone: "#f472b6",
};

function colorOf(navIcon: string): string {
  return COLOR[navIcon] ?? "#cbd5e1";
}

// Clé d'un corps (stem du recordName) et clé parent (parentRef), pour rattacher
// lunes/POI à leur planète. Symétrique à la logique 2D existante.
function keyOf(b: StarmapBodyItem): string {
  return (b.recordName.split(".").pop() ?? b.name).toLowerCase();
}
function parentKeyOf(b: StarmapBodyItem): string {
  return (b.parentRef ?? "").toLowerCase();
}

type Node = {
  body: StarmapBodyItem;
  pos: [number, number, number];
  radius: number;
  color: string;
};

function buildLayout(bodies: StarmapBodyItem[]): { nodes: Node[]; orbits: number[] } {
  const star = bodies.find((b) => b.navIcon === "Star") ?? null;
  const planets = bodies
    .filter((b) => b.navIcon === "Planet")
    .sort((a, b) => {
      // Ordre orbital (intérieur → extérieur) si connu, sinon ordre stable par recordName.
      if (a.orbitOrder != null && b.orbitOrder != null) return a.orbitOrder - b.orbitOrder;
      return a.recordName > b.recordName ? 1 : -1;
    });
  const moons = bodies.filter((b) => b.navIcon === "Moon");
  const pois = bodies.filter((b) =>
    ["Station", "Outpost", "LandingZone", "Lagrange"].includes(b.navIcon),
  );

  const nodes: Node[] = [];
  const orbits: number[] = [];

  if (star) {
    nodes.push({ body: star, pos: [0, 0, 0], radius: 2.4, color: colorOf("Star") });
  }

  const planetPos = new Map<string, [number, number, number]>();
  planets.forEach((p, i) => {
    const r = 7 + i * 4.5;
    orbits.push(r);
    const ang = (i / Math.max(1, planets.length)) * Math.PI * 2 + i * 0.7;
    const y = (i % 2 === 0 ? 1 : -1) * 0.6;
    const pos: [number, number, number] = [Math.cos(ang) * r, y, Math.sin(ang) * r];
    planetPos.set(keyOf(p), pos);
    nodes.push({ body: p, pos, radius: 1.2, color: colorOf("Planet") });
  });

  // Lunes : autour de leur planète (parentRef), sinon petit anneau autour de l'étoile.
  const moonsByParent = new Map<string, StarmapBodyItem[]>();
  moons.forEach((m) => {
    const k = parentKeyOf(m);
    if (!moonsByParent.has(k)) moonsByParent.set(k, []);
    moonsByParent.get(k)!.push(m);
  });
  moonsByParent.forEach((list, parent) => {
    const base = planetPos.get(parent);
    list.forEach((m, j) => {
      const mr = 2.4 + j * 1.0;
      const ma = (j / Math.max(1, list.length)) * Math.PI * 2;
      const pos: [number, number, number] = base
        ? [base[0] + Math.cos(ma) * mr, base[1] + 0.3, base[2] + Math.sin(ma) * mr]
        : [Math.cos(ma) * (4 + j), 0, Math.sin(ma) * (4 + j)];
      nodes.push({ body: m, pos, radius: 0.45, color: colorOf("Moon") });
    });
  });

  // POI : rattachés à leur parent (planète/lune) s'il est connu, sinon dispersés.
  pois.forEach((poi, idx) => {
    const base = planetPos.get(parentKeyOf(poi));
    const a = idx * 0.9;
    const pos: [number, number, number] = base
      ? [base[0] + Math.cos(a) * 2.0, base[1] + 1.0, base[2] + Math.sin(a) * 2.0]
      : [Math.cos(a) * (10 + idx), 1.5, Math.sin(a) * (10 + idx)];
    nodes.push({ body: poi, pos, radius: 0.35, color: colorOf(poi.navIcon) });
  });

  return { nodes, orbits };
}

function OrbitRing({ radius }: { radius: number }) {
  const points = useMemo(() => {
    const pts: number[] = [];
    const seg = 96;
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
  const isStar = node.body.navIcon === "Star";
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
        <sphereGeometry args={[node.radius, 32, 32]} />
        {isStar ? (
          <meshBasicMaterial color={node.color} />
        ) : (
          <meshStandardMaterial
            color={node.color}
            emissive={node.color}
            emissiveIntensity={hovered || selected ? 0.6 : 0.15}
            roughness={0.7}
          />
        )}
      </mesh>
      {isStar && <pointLight intensity={2.2} distance={200} decay={0} />}
      {(hovered || selected) && (
        <Html center distanceFactor={40} style={{ pointerEvents: "none" }}>
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
  const { nodes, orbits } = useMemo(
    () => buildLayout(bodies.filter((b) => b.systemName === system)),
    [bodies, system],
  );

  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl border border-white/10 bg-black">
      <Canvas camera={{ position: [0, 28, 42], fov: 55 }} onPointerMissed={() => setSelected(null)}>
        <ambientLight intensity={0.35} />
        <Stars radius={300} depth={60} count={4000} factor={4} fade speed={0.5} />
        {orbits.map((r, i) => (
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
        <OrbitControls
          enablePan
          enableDamping
          dampingFactor={0.1}
          minDistance={6}
          maxDistance={160}
        />
      </Canvas>

      {selected && (
        <div className="absolute left-3 top-3 max-w-xs rounded-xl border border-white/15 bg-[#0a0a0f]/85 p-3 backdrop-blur">
          <div className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ background: colorOf(selected.navIcon) }}
            />
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
