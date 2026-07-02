import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { Line, Html, OrbitControls } from "@react-three/drei";
import type { TFunction } from "i18next";

/* Scène 3D d'UN système pour la carte du GPS trading (remplace le SVG plat SystemBox).
   Corps (étoile/planètes) ET étapes du trajet sont placés à leurs positions BRUTES x/y/z
   (même repère → alignement exact, aucun matching de noms). Plan orbital ≈ XY brut → mappé
   sur le plan horizontal three (XZ), l'axe brut Z (hors-plan, petit) devient la hauteur. */

type StarmapBodyItem = {
  id: string;
  systemName: string;
  navIcon: string;
  name: string;
  posX: number | null;
  posY: number | null;
  posZ: number | null;
  hideInStarmap?: boolean;
};

export type TripNode3D = {
  key: string;
  name: string;
  system: string | null;
  pos: { x: number; y: number; z: number } | null;
};

type Vec3 = [number, number, number];

export function SystemScene3D({
  bodies,
  nodes,
  startKey,
  currentKey,
  junctionKey,
  t,
}: {
  bodies: StarmapBodyItem[];
  nodes: TripNode3D[];
  startKey: string | null;
  currentKey: string | null;
  junctionKey: string | null;
  t: TFunction;
}) {
  const scene = useMemo(() => {
    const visible = (b: StarmapBodyItem) =>
      !b.hideInStarmap && b.posX != null && b.posY != null && b.posZ != null;
    const star = bodies.find((b) => b.navIcon === "Star" && visible(b)) ?? null;
    const planets = bodies.filter((b) => b.navIcon === "Planet" && visible(b));
    const placed = nodes.filter((n) => n.pos);

    // Nuage de points brut (étoile + planètes + étapes) → centre + échelle.
    const cloud: Array<[number, number, number]> = [
      ...(star ? [[star.posX!, star.posY!, star.posZ!] as Vec3] : []),
      ...planets.map((p) => [p.posX!, p.posY!, p.posZ!] as Vec3),
      ...placed.map((n) => [n.pos!.x, n.pos!.y, n.pos!.z] as Vec3),
    ];
    const pts = cloud.length ? cloud : [[0, 0, 0] as Vec3];
    const axis = (i: number) => pts.map((p) => p[i]);
    const mid = (i: number) => (Math.min(...axis(i)) + Math.max(...axis(i))) / 2;
    const span = (i: number) => Math.max(1, Math.max(...axis(i)) - Math.min(...axis(i)));
    const c: Vec3 = [mid(0), mid(1), mid(2)];
    const s = 90 / Math.max(span(0), span(1), span(2));

    // Brut (x,y,z) → three (x, zHauteur, y) centré/échelonné.
    const to3 = (x: number, y: number, z: number): Vec3 => [(x - c[0]) * s, (z - c[2]) * s, (y - c[1]) * s];

    const starPos = star ? to3(star.posX!, star.posY!, star.posZ!) : ([0, 0, 0] as Vec3);
    const planetsOut = planets.map((p) => {
      const pos = to3(p.posX!, p.posY!, p.posZ!);
      // Rayon orbital = distance planaire (x,y bruts) étoile→planète, en unités three.
      const dx = p.posX! - (star ? star.posX! : 0);
      const dy = p.posY! - (star ? star.posY! : 0);
      const orbit = Math.hypot(dx, dy) * s;
      return { id: p.id, pos, orbit };
    });
    const nodesOut = placed.map((n) => ({
      key: n.key,
      name: n.name,
      pos: to3(n.pos!.x, n.pos!.y, n.pos!.z),
    }));
    const line: Vec3[] = nodesOut.map((n) => n.pos);
    const radius = 90;
    return { starPos, planetsOut, nodesOut, line, radius, hasStar: !!star };
  }, [bodies, nodes]);

  // Cercle d'orbite (plan horizontal XZ) centré sur l'étoile.
  const orbitPoints = (center: Vec3, r: number): Vec3[] => {
    const seg = 96;
    const arr: Vec3[] = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      arr.push([center[0] + r * Math.cos(a), center[1], center[2] + r * Math.sin(a)]);
    }
    return arr;
  };

  const cam: Vec3 = [0, scene.radius * 0.9, scene.radius * 1.35];

  return (
    <div className="h-full w-full overflow-hidden rounded-xl" style={{ background: "radial-gradient(ellipse at 50% 45%, rgba(30,32,48,0.6), rgba(8,9,15,0.96))" }}>
      <Canvas camera={{ position: cam, fov: 45, far: 6000 }}>
        <ambientLight intensity={0.5} />
        {scene.hasStar && <pointLight position={scene.starPos} intensity={1.4} distance={0} decay={0} color="#f5a623" />}
        <directionalLight position={[scene.radius, scene.radius * 2, scene.radius]} intensity={0.4} />

        {/* Étoile */}
        {scene.hasStar && (
          <mesh position={scene.starPos}>
            <sphereGeometry args={[3.4, 24, 24]} />
            <meshBasicMaterial color="#f5a623" />
          </mesh>
        )}

        {/* Orbites + planètes */}
        {scene.planetsOut.map((p) => (
          <group key={p.id}>
            {p.orbit > 2 && (
              <Line points={orbitPoints(scene.starPos, p.orbit)} color="#ffffff" transparent opacity={0.12} lineWidth={1} />
            )}
            <mesh position={p.pos}>
              <sphereGeometry args={[1.8, 20, 20]} />
              <meshStandardMaterial color="#46588a" roughness={0.8} metalness={0.1} />
            </mesh>
          </group>
        ))}

        {/* Trajet interne (polyligne) */}
        {scene.line.length >= 2 && (
          <Line points={scene.line} color="#f5a623" lineWidth={2.4} dashed dashSize={2.4} gapSize={1.6} />
        )}

        {/* Étapes : marqueurs + labels (départ / actuel). */}
        {scene.nodesOut.map((n) => {
          const isCurrent = n.key === currentKey;
          const isStart = n.key === startKey;
          const isJunction = n.key === junctionKey;
          const color = isCurrent ? "var(--accent)" : "#34d399";
          return (
            <group key={n.key} position={n.pos}>
              {isJunction && (
                <mesh>
                  <ringGeometry args={[3.4, 4, 24]} />
                  <meshBasicMaterial color="#f5a623" transparent opacity={0.7} side={2} />
                </mesh>
              )}
              <mesh>
                <sphereGeometry args={[isCurrent ? 2.1 : 1.5, 16, 16]} />
                <meshBasicMaterial color={isCurrent ? "#f5a623" : "#34d399"} />
              </mesh>
              {(isStart || isCurrent) && (
                <Html position={[0, 4, 0]} center style={{ pointerEvents: "none" }}>
                  <div className="whitespace-nowrap rounded bg-black/75 px-1.5 py-0.5 text-[11px] font-semibold" style={{ color }}>
                    {n.name}
                    {isCurrent && <span className="ml-1 font-normal opacity-80">· {t("cargo.gps.youAreHere")}</span>}
                  </div>
                </Html>
              )}
            </group>
          );
        })}

        <OrbitControls enablePan enableDamping dampingFactor={0.1} minDistance={20} maxDistance={scene.radius * 4} />
      </Canvas>
    </div>
  );
}
