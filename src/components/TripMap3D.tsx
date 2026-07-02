import { useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Html, OrbitControls, Stars } from "@react-three/drei";
import type { TFunction } from "i18next";
import { safeName, type StarmapBodyItem } from "./StarmapCanvas";
import {
  layoutSystem,
  ringPoints,
  parentJoinKey,
  bodyJoinKey,
} from "./starmap3d/Starmap3D";
import { TILT_DEG, type Vec3 } from "./starmap3d/placement";
import { Planet, StarSphere, OrbitRing, AsteroidBelt, IconSprite, Station, BodyLabel } from "./starmap3d/primitives";
import { CameraFocus, type FocusTarget } from "./starmap3d/CameraFocus";

/* Scène 3D d'UN système pour la carte du GPS trading. Rendu IDENTIQUE à l'onglet Starmap
   (même layoutSystem + primitives : planètes texturées, étoile+halo, orbites, stations LOD,
   sprites de saut). Le trajet est superposé en mappant chaque étape au corps placé
   correspondant (par nom), avec polyligne + marqueurs départ/actuel/point de saut. */

const TILT = (TILT_DEG * Math.PI) / 180;

export type TripNode3D = {
  key: string;
  name: string;
  system: string | null;
  pos: { x: number; y: number; z: number } | null;
};

/** Segments de tirets « ---- » le long de la polyligne (dash/gap en unités monde). */
function dashSegments(points: Vec3[], dash = 11, gap = 7): Float32Array {
  const v: number[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, ay, az] = points[i];
    const [bx, by, bz] = points[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len = Math.hypot(dx, dy, dz) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const uz = dz / len;
    for (let t = 0; t < len; t += dash + gap) {
      const t2 = Math.min(t + dash, len);
      v.push(ax + ux * t, ay + uy * t, az + uz * t, ax + ux * t2, ay + uy * t2, az + uz * t2);
    }
  }
  return new Float32Array(v);
}

export function SystemScene3D({
  bodies,
  systemId,
  nodes,
  startKey,
  currentKey,
  junctionKey,
  t,
}: {
  bodies: StarmapBodyItem[];
  systemId: string | null;
  nodes: TripNode3D[];
  startKey: string | null;
  currentKey: string | null;
  junctionKey: string | null;
  t: TFunction;
}) {
  // La casse du système du trajet peut différer des corps → on aligne sur les corps
  // eux-mêmes (sinon layoutSystem, sensible à la casse, renvoie vide → carte blanche).
  const placed = useMemo(() => {
    const sys = bodies.find((b) => b.systemName)?.systemName ?? systemId;
    return sys ? layoutSystem(bodies, sys) : [];
  }, [bodies, systemId]);

  // Clic sur un corps → zoom caméra animé dessus.
  const [camFocus, setCamFocus] = useState<FocusTarget | null>(null);
  const nonceRef = useRef(0);
  const focusOn = (pos: Vec3, radius: number) =>
    setCamFocus({ pos, dist: Math.max((radius || 4) * 7, 16), nonce: ++nonceRef.current });

  // Corps enfants (lunes/stations) : on ne montre que les rings de planètes en vue système.
  const rings = useMemo(
    () => placed.filter((p) => p.kind === "planet" && p.ringR != null).map((p) => ringPoints(p.ringR!)),
    [placed],
  );
  const focusableParent = (b: StarmapBodyItem) =>
    placed.some((c) => parentJoinKey(c.body) === bodyJoinKey(b));

  // Mappe chaque étape à sa position 3D via le CORPS le plus proche en coordonnées BRUTES
  // (corps et étapes partagent le même repère x/y/z) → robuste, sans dépendre des noms.
  const tripPoints = useMemo(() => {
    const raw = placed.filter((p) => p.body.posX != null && p.body.posY != null && p.body.posZ != null);
    const nearest = (x: number, y: number, z: number): Vec3 | null => {
      let best: Vec3 | null = null;
      let bd = Infinity;
      for (const p of raw) {
        const dx = (p.body.posX as number) - x;
        const dy = (p.body.posY as number) - y;
        const dz = (p.body.posZ as number) - z;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bd) {
          bd = d;
          best = p.pos;
        }
      }
      return best;
    };
    const out: Array<{ key: string; name: string; pos: Vec3 }> = [];
    for (const n of nodes) {
      if (!n.pos) continue;
      const pos = nearest(n.pos.x, n.pos.y, n.pos.z);
      if (pos) out.push({ key: n.key, name: n.name, pos });
    }
    return out;
  }, [placed, nodes]);

  const dashes = useMemo(() => {
    const pts = tripPoints.map((p) => p.pos);
    return pts.length >= 2 ? dashSegments(pts) : null;
  }, [tripPoints]);

  return (
    <div className="h-full w-full overflow-hidden rounded-xl border border-white/10 bg-black">
      <Canvas camera={{ position: [0, 240, 360], fov: 50, far: 8000 }}>
        <ambientLight intensity={0.34} />
        <Stars radius={2000} depth={400} count={2000} factor={6} fade speed={0.2} />

        {rings.map((pts, i) => (
          <OrbitRing key={`ring${i}`} points={pts} />
        ))}

        {placed.map((p) => {
          if (p.kind === "star") return <StarSphere key={p.body.id} position={p.pos} radius={p.radius} />;
          if (p.kind === "belt") return <AsteroidBelt key={p.body.id} radius={p.ringR ?? 100} tilt={TILT} />;
          if (p.kind === "jump")
            return (
              <IconSprite
                key={p.body.id}
                position={p.pos}
                kind="jump"
                frac={0.045}
                onClick={(e) => {
                  e.stopPropagation();
                  focusOn(p.pos, 4);
                }}
              />
            );
          if (p.kind === "station")
            return (
              <Station
                key={p.body.id}
                position={p.pos}
                frac={0.03}
                onClick={(e) => {
                  e.stopPropagation();
                  focusOn(p.pos, 4);
                }}
              />
            );
          return (
            <group key={p.body.id}>
              <Planet
                position={p.pos}
                radius={p.radius}
                appearance={p.body.appearance}
                habitable={p.body.habitable}
                isMoon={p.kind === "moon"}
                selected={false}
                onClick={(e) => {
                  e.stopPropagation();
                  focusOn(p.pos, p.radius);
                }}
                onOver={() => undefined}
                onOut={() => undefined}
              />
              {(p.kind === "planet" || (p.kind === "moon" && focusableParent(p.body))) && (
                <BodyLabel position={[p.pos[0], p.pos[1] + p.radius + 4, p.pos[2]]} text={safeName(p.body)} />
              )}
            </group>
          );
        })}

        {/* Trajet superposé : tirets « ---- » entre chaque point + marqueurs. */}
        {dashes && (
          <lineSegments>
            <bufferGeometry>
              <bufferAttribute attach="attributes-position" args={[dashes, 3]} />
            </bufferGeometry>
            <lineBasicMaterial color="#f5a623" transparent opacity={0.95} />
          </lineSegments>
        )}
        {tripPoints.map((p, i) => {
          const isCurrent = p.key === currentKey;
          const isStart = p.key === startKey;
          const isJunction = p.key === junctionKey;
          const color = isCurrent ? "#f5a623" : isStart ? "#7cc4ff" : "#34d399";
          return (
            <group key={`trip-${p.key}-${i}`} position={p.pos}>
              {isJunction && (
                <mesh rotation={[-Math.PI / 2, 0, 0]}>
                  <ringGeometry args={[9, 11, 32]} />
                  <meshBasicMaterial color="#f5a623" transparent opacity={0.75} side={2} />
                </mesh>
              )}
              <mesh>
                <sphereGeometry args={[isCurrent ? 6 : 4.5, 16, 16]} />
                <meshBasicMaterial color={color} />
              </mesh>
              {/* Chaque point : badge numéroté (ordre du trajet) + nom. */}
              <Html position={[0, 10, 0]} center distanceFactor={60} style={{ pointerEvents: "none" }}>
                <div className="flex items-center gap-1 whitespace-nowrap rounded bg-black/78 px-1 py-0.5 text-[11px]">
                  <span
                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold"
                    style={{ background: color, color: "#0a0a0f" }}
                  >
                    {i + 1}
                  </span>
                  <span className="font-semibold" style={{ color }}>
                    {p.name}
                  </span>
                  {isCurrent && <span className="opacity-80">· {t("cargo.gps.youAreHere")}</span>}
                </div>
              </Html>
            </group>
          );
        })}

        <OrbitControls makeDefault enablePan enableDamping dampingFactor={0.1} minDistance={20} maxDistance={2000} />
        <CameraFocus target={camFocus} />
      </Canvas>
    </div>
  );
}
