import { useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Stars, Html } from "@react-three/drei";
import {
  buildSystemLayout,
  bodyColor,
  safeName,
  TILT,
  GALAXY_POSITIONS,
  GALAXY_LINKS,
  SYSTEM_COLORS,
  SYSTEM_NAMES,
  type StarmapBodyItem,
  type BodyLayout,
} from "./StarmapCanvas";

/* ──────────────────────────────────────────────────────────────────────────
 * Carte galactique 3D (Phase 3) — REPREND la logique de la 2D :
 *  • placement : même buildSystemLayout (logRadius des vraies distances posX/Y/Z,
 *    angle atan2(posY,posX), rattachement parent par wikiUuid) ; les coords écran
 *    (wx, wy) sont levées dans le plan orbital 3D en dé-tiltant wy (z = wy/TILT).
 *  • niveaux de vue : GALAXIE → SYSTÈME → OBJET (clic pour entrer, boutons GLX/SYS
 *    pour remonter), comme la 2D.
 * ────────────────────────────────────────────────────────────────────────── */

const SCALE = 0.1; // px (layout 2D) → unités 3D (niveaux système/objet)
const GAL_SCALE = 0.06; // positions de galaxie → unités 3D

type Vec3 = [number, number, number];

// (wx, wy) 2D → position 3D dans le plan orbital (y = 0).
function to3D(wx: number, wy: number, scale = SCALE): Vec3 {
  return [wx * scale, 0, (wy / TILT) * scale];
}
function radiusOf(rv: number, isStar: boolean): number {
  return Math.max(isStar ? 1.4 : 0.35, rv * (isStar ? 0.18 : 0.14));
}

type Node = { body: StarmapBodyItem; pos: Vec3; r: number; color: string; isStar: boolean };

type View =
  | { level: "galaxy" }
  | { level: "system"; systemId: string }
  | { level: "object"; systemId: string; bodyId: string };

/* ── Données par niveau ── */

function galaxyData(bodies: StarmapBodyItem[]) {
  const systems = [...new Set(bodies.map((b) => b.systemName))];
  const nodes = systems.map((s) => {
    const key = s.toLowerCase();
    const gp = GALAXY_POSITIONS[key] ?? { gx: 0, gy: 0 };
    return {
      id: s,
      name: SYSTEM_NAMES[key] ?? s.toUpperCase(),
      color: SYSTEM_COLORS[key] ?? "#f5a623",
      pos: [gp.gx * GAL_SCALE, 0, gp.gy * GAL_SCALE] as Vec3,
    };
  });
  const posOf = (id: string) =>
    nodes.find((n) => n.id.toLowerCase() === id.toLowerCase())?.pos ?? null;
  const links = GALAXY_LINKS.map(([a, b]) => [posOf(a), posOf(b)]).filter(
    (l): l is [Vec3, Vec3] => l[0] != null && l[1] != null,
  );
  return { nodes, links };
}

function systemData(bodies: StarmapBodyItem[], systemId: string) {
  const sys = buildSystemLayout(bodies.filter((b) => b.systemName === systemId), systemId);
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
    for (const ch of pl.children) add(ch);
  }
  for (const m of sys.moons) add(m);
  for (const gw of sys.gateways) add(gw);
  // Corps « entrables » (objet) = ceux qui ont des enfants (planètes, lunes à POI).
  const focusable = new Set<string>();
  for (const pl of sys.planets) if (pl.children.length > 0) focusable.add(pl.body.id);
  for (const m of sys.moons) if (m.children.length > 0) focusable.add(m.body.id);
  return { nodes, rings, focusable };
}

function objectData(bodies: StarmapBodyItem[], systemId: string, bodyId: string) {
  const sys = buildSystemLayout(bodies.filter((b) => b.systemName === systemId), systemId);
  let focus: BodyLayout | null =
    [...sys.planets, ...sys.moons].find((bl) => bl.body.id === bodyId) ?? null;
  if (!focus) {
    for (const p of sys.planets) {
      const c = p.children.find((ch) => ch.body.id === bodyId);
      if (c) {
        focus = c;
        break;
      }
    }
  }
  if (!focus) return null;
  const OBJ = 0.1;
  const c = focus;
  const nodes: Node[] = [
    {
      body: c.body,
      pos: [0, 0, 0],
      r: Math.max(1.3, c.rv * 0.2),
      color: bodyColor(c.body),
      isStar: c.body.navIcon === "Star",
    },
  ];
  const rings: number[] = [];
  for (const ch of c.children) {
    nodes.push({
      body: ch.body,
      pos: [(ch.wx - c.wx) * OBJ, 0, ((ch.wy - c.wy) / TILT) * OBJ],
      r: radiusOf(ch.rv, false),
      color: bodyColor(ch.body),
      isStar: false,
    });
    if (ch.body.navIcon === "Moon") rings.push(ch.ring * OBJ);
  }
  return { nodes, rings, focus: c };
}

/* ── Primitives 3D ── */

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

function LinkLine({ a, b }: { a: Vec3; b: Vec3 }) {
  const points = useMemo(() => new Float32Array([...a, ...b]), [a, b]);
  return (
    <line>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[points, 3]} />
      </bufferGeometry>
      <lineBasicMaterial color="#f5a623" transparent opacity={0.35} />
    </line>
  );
}

function BodyMesh({
  node,
  selected,
  onClick,
}: {
  node: Node;
  selected: boolean;
  onClick: (b: StarmapBodyItem) => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <group position={node.pos}>
      <mesh
        onClick={(e) => {
          e.stopPropagation();
          onClick(node.body);
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
      {node.isStar && <pointLight intensity={2.4} distance={500} decay={0} />}
      {(hovered || selected) && (
        <Html center distanceFactor={50} style={{ pointerEvents: "none" }}>
          <div className="whitespace-nowrap rounded bg-black/80 px-1.5 py-0.5 text-[11px] text-white">
            {safeName(node.body)}
          </div>
        </Html>
      )}
    </group>
  );
}

function SystemDot({
  s,
  onClick,
}: {
  s: { id: string; name: string; color: string; pos: Vec3 };
  onClick: (id: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <group position={s.pos}>
      <mesh
        onClick={(e) => {
          e.stopPropagation();
          onClick(s.id);
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={() => setHovered(false)}
      >
        <sphereGeometry args={[hovered ? 1.5 : 1.2, 24, 24]} />
        <meshBasicMaterial color={s.color} />
      </mesh>
      <pointLight intensity={1.2} distance={40} decay={0} color={s.color} />
      <Html center distanceFactor={60} style={{ pointerEvents: "none" }}>
        <div className="whitespace-nowrap text-[12px] font-bold tracking-wider" style={{ color: s.color }}>
          {s.name}
        </div>
      </Html>
    </group>
  );
}

/* ── Composant ── */

export default function Starmap3D({
  bodies,
  system,
}: {
  bodies: StarmapBodyItem[];
  system: string;
}) {
  const [view, setView] = useState<View>({ level: "system", systemId: system });
  const [selected, setSelected] = useState<StarmapBodyItem | null>(null);

  const galaxy = useMemo(() => galaxyData(bodies), [bodies]);
  const sys = useMemo(
    () => (view.level !== "galaxy" ? systemData(bodies, view.systemId) : null),
    [bodies, view],
  );
  const obj = useMemo(
    () => (view.level === "object" ? objectData(bodies, view.systemId, view.bodyId) : null),
    [bodies, view],
  );

  const camPos: Vec3 =
    view.level === "galaxy" ? [0, 46, 62] : view.level === "object" ? [0, 9, 15] : [0, 38, 56];
  const camKey =
    view.level === "galaxy"
      ? "galaxy"
      : view.level === "object"
        ? `obj:${view.systemId}:${view.bodyId}`
        : `sys:${view.systemId}`;

  const currentSystemId = view.level === "galaxy" ? null : view.systemId;
  const crumb =
    view.level === "galaxy"
      ? "GALAXIE"
      : view.level === "object"
        ? (obj?.focus ? safeName(obj.focus.body).toUpperCase() : "")
        : SYSTEM_NAMES[view.systemId.toLowerCase()] ?? view.systemId.toUpperCase();

  function onBodyClick(b: StarmapBodyItem) {
    setSelected(b);
    if (view.level === "system" && sys?.focusable.has(b.id)) {
      setView({ level: "object", systemId: view.systemId, bodyId: b.id });
    }
  }

  const navBtn =
    "cursor-pointer rounded px-2 py-0.5 text-[11px] font-semibold tracking-wider text-white/60 transition-colors hover:text-[var(--accent)]";

  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl border border-white/10 bg-black">
      {/* HUD de navigation (galaxie / système / objet) */}
      <div className="absolute left-3 top-3 z-10 flex items-center gap-1.5">
        <span className={navBtn} onClick={() => setView({ level: "galaxy" })}>
          GLX
        </span>
        {currentSystemId && (
          <span
            className={navBtn}
            onClick={() => setView({ level: "system", systemId: currentSystemId })}
          >
            SYS
          </span>
        )}
        <span
          className="ml-2 text-[12px] font-bold uppercase tracking-[0.18em]"
          style={{ color: "var(--accent)" }}
        >
          {crumb}
        </span>
      </div>

      <Canvas key={camKey} camera={{ position: camPos, fov: 50 }} onPointerMissed={() => setSelected(null)}>
        <ambientLight intensity={0.4} />
        <Stars radius={500} depth={90} count={5000} factor={4} fade speed={0.4} />

        {view.level === "galaxy" && (
          <>
            {galaxy.links.map((l, i) => (
              <LinkLine key={i} a={l[0]} b={l[1]} />
            ))}
            {galaxy.nodes.map((s) => (
              <SystemDot
                key={s.id}
                s={s}
                onClick={(id) => setView({ level: "system", systemId: id })}
              />
            ))}
          </>
        )}

        {view.level === "system" && sys && (
          <>
            {sys.rings.map((r, i) => (
              <OrbitRing key={i} radius={r} />
            ))}
            {sys.nodes.map((n) => (
              <BodyMesh
                key={n.body.id}
                node={n}
                selected={selected?.id === n.body.id}
                onClick={onBodyClick}
              />
            ))}
          </>
        )}

        {view.level === "object" && obj && (
          <>
            {obj.rings.map((r, i) => (
              <OrbitRing key={i} radius={r} />
            ))}
            {obj.nodes.map((n) => (
              <BodyMesh
                key={n.body.id}
                node={n}
                selected={selected?.id === n.body.id}
                onClick={setSelected}
              />
            ))}
          </>
        )}

        <OrbitControls enablePan enableDamping dampingFactor={0.1} minDistance={3} maxDistance={400} />
      </Canvas>

      {selected && (
        <div className="absolute left-3 bottom-3 max-w-xs rounded-xl border border-white/15 bg-[#0a0a0f]/85 p-3 backdrop-blur">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: bodyColor(selected) }} />
            <span className="text-sm font-semibold text-white">{safeName(selected)}</span>
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
