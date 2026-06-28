import { useMemo, useRef } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { SYS_R, type Vec3 } from "./placement";
import { bodyTexture, starGlowTexture, textureKindFor } from "./textures";

const SYS_LIGHT = 4000;
// Distance camera sous laquelle une station passe de l'icone au modele 3D.
const STATION_SWAP_DIST = SYS_R * 0.18;

/** Taille MONDE pour qu'un sprite occupe ~`frac` de la hauteur écran à distance `d`. */
export function screenScale(d: number, frac: number, fov: number): number {
  return frac * 2 * d * Math.tan((fov * Math.PI) / 360);
}

export function StarSphere({
  position,
  radius,
  color = "#fff4dd",
}: {
  position: Vec3;
  radius: number;
  color?: string;
}) {
  const glow = useMemo(() => starGlowTexture(), []);
  return (
    <group position={position}>
      <mesh>
        <sphereGeometry args={[radius, 48, 32]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <sprite scale={[radius * 9, radius * 9, 1]}>
        <spriteMaterial
          map={glow}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          opacity={0.9}
        />
      </sprite>
      <pointLight intensity={2.2} distance={SYS_LIGHT} decay={0} />
    </group>
  );
}

export function Planet({
  position,
  radius,
  appearance,
  habitable,
  isMoon,
  selected,
  onClick,
  onOver,
  onOut,
}: {
  position: Vec3;
  radius: number;
  appearance: string | null;
  habitable: number | null;
  isMoon: boolean;
  selected: boolean;
  onClick: (e: ThreeEvent<MouseEvent>) => void;
  onOver: () => void;
  onOut: () => void;
}) {
  const tex = useMemo(() => bodyTexture(textureKindFor(appearance)), [appearance]);
  return (
    <group position={position}>
      <mesh
        onClick={onClick}
        onPointerOver={(e) => {
          e.stopPropagation();
          onOver();
        }}
        onPointerOut={onOut}
      >
        <sphereGeometry args={[radius, isMoon ? 24 : 40, isMoon ? 16 : 28]} />
        <meshStandardMaterial
          map={tex}
          roughness={1}
          metalness={0}
          emissive={selected ? "#1a3a4a" : "#000000"}
        />
      </mesh>
      {habitable === 1 && !isMoon && (
        <mesh scale={[radius * 1.06, radius * 1.06, radius * 1.06]}>
          <sphereGeometry args={[1, 24, 16]} />
          <meshBasicMaterial color="#54e6ff" transparent opacity={0.06} side={THREE.BackSide} />
        </mesh>
      )}
    </group>
  );
}

export function OrbitRing({ points }: { points: Float32Array }) {
  return (
    <line>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[points, 3]} />
      </bufferGeometry>
      <lineBasicMaterial color="#84b0e0" transparent opacity={0.16} />
    </line>
  );
}

export function AsteroidBelt({ radius, tilt }: { radius: number; tilt: number }) {
  const pts = useMemo(() => {
    const n = 500;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = radius + (Math.random() - 0.5) * 10;
      const x = rr * Math.cos(a);
      const z = rr * Math.sin(a);
      arr[i * 3] = x;
      arr[i * 3 + 1] = -z * Math.sin(tilt) + (Math.random() - 0.5) * 2;
      arr[i * 3 + 2] = z * Math.cos(tilt);
    }
    return arr;
  }, [radius, tilt]);
  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[pts, 3]} />
      </bufferGeometry>
      <pointsMaterial color="#93a7c0" size={1.6} sizeAttenuation={false} transparent opacity={0.5} />
    </points>
  );
}

const iconCache = new Map<string, THREE.CanvasTexture>();
function iconTexture(kind: "station" | "jump"): THREE.CanvasTexture {
  const hit = iconCache.get(kind);
  if (hit) return hit;
  const S = 64;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const x = c.getContext("2d")!;
  const jump = kind === "jump";
  // puce arrondie sombre + liseré (cyan station / ambre jump)
  const r = 14;
  const a = 4;
  const b = 4;
  const w = S - 8;
  const h = S - 8;
  x.beginPath();
  x.moveTo(a + r, b);
  x.arcTo(a + w, b, a + w, b + h, r);
  x.arcTo(a + w, b + h, a, b + h, r);
  x.arcTo(a, b + h, a, b, r);
  x.arcTo(a, b, a + w, b, r);
  x.closePath();
  x.fillStyle = "rgba(6,11,20,.92)";
  x.fill();
  x.lineWidth = 2.5;
  x.strokeStyle = jump ? "rgba(255,196,108,.95)" : "rgba(125,222,255,.9)";
  x.stroke();
  x.save();
  x.translate(32, 32);
  x.strokeStyle = jump ? "#ffd9a0" : "#f1f7ff";
  x.fillStyle = x.strokeStyle;
  x.lineWidth = 3;
  x.lineJoin = "round";
  x.lineCap = "round";
  if (jump) {
    for (const rad of [13, 7]) {
      x.lineWidth = rad === 13 ? 3 : 2;
      x.beginPath();
      for (let i = 0; i <= 6; i++) {
        const an = (Math.PI / 3) * i - Math.PI / 2;
        const fn = i ? "lineTo" : "moveTo";
        x[fn](Math.cos(an) * rad, Math.sin(an) * rad);
      }
      x.closePath();
      x.stroke();
    }
    x.beginPath();
    x.arc(0, 0, 2, 0, 7);
    x.fill();
  } else {
    x.beginPath();
    x.ellipse(0, 0, 14, 8, 0, 0, 7);
    x.stroke();
    x.beginPath();
    x.arc(0, 0, 4.5, 0, 7);
    x.fill();
  }
  x.restore();
  const t = new THREE.CanvasTexture(c);
  t.minFilter = THREE.LinearFilter;
  iconCache.set(kind, t);
  return t;
}

/** Sprite icône (canvas) à taille-écran constante. */
export function IconSprite({
  position,
  kind,
  frac,
  onClick,
}: {
  position: Vec3;
  kind: "station" | "jump";
  frac: number;
  onClick?: (e: ThreeEvent<MouseEvent>) => void;
}) {
  const ref = useRef<THREE.Sprite>(null);
  const tex = useMemo(() => iconTexture(kind), [kind]);
  const { camera } = useThree();
  useFrame(() => {
    const s = ref.current;
    if (!s) return;
    const d = camera.position.distanceTo(s.position);
    const fov = (camera as THREE.PerspectiveCamera).fov ?? 50;
    const sc = screenScale(d, frac, fov);
    s.scale.set(sc, sc, 1);
  });
  return (
    <sprite ref={ref} position={position} onClick={onClick}>
      <spriteMaterial map={tex} transparent depthTest />
    </sprite>
  );
}

export function BodyLabel({ position, text }: { position: Vec3; text: string }) {
  return (
    <Html position={position} center distanceFactor={60} style={{ pointerEvents: "none" }}>
      <div className="whitespace-nowrap rounded bg-black/70 px-1.5 py-0.5 text-[11px] text-white/90">
        {text}
      </div>
    </Html>
  );
}

/* Modele 3D procedural de station (hub + anneau + bras + antenne). Aucun asset CIG :
   forme stylisee maison. Geometries/materiaux partages (construits une fois). */
const staHull = new THREE.MeshStandardMaterial({ color: 0x9fb2cc, roughness: 0.55, metalness: 0.4 });
const staDark = new THREE.MeshStandardMaterial({ color: 0x46566e, roughness: 0.7, metalness: 0.3 });
const staGlow = new THREE.MeshBasicMaterial({ color: 0x54e6ff });
const gCore = new THREE.CylinderGeometry(0.3, 0.3, 1.5, 12);
const gHub = new THREE.CylinderGeometry(0.52, 0.52, 0.3, 14);
const gRing = new THREE.TorusGeometry(1.12, 0.12, 8, 30);
const gArm = new THREE.BoxGeometry(1.1, 0.07, 0.07);
const gAnt = new THREE.CylinderGeometry(0.02, 0.02, 0.8, 6);
const gDot = new THREE.SphereGeometry(0.06, 8, 6);

/** Sous-arbre du modele 3D de station (echelle 1 ; mis a l'echelle par le parent). */
function StationModelMeshes() {
  return (
    <group rotation={[0.35, 0, 0]}>
      <mesh geometry={gCore} material={staHull} />
      <mesh geometry={gHub} material={staDark} />
      <mesh geometry={gRing} material={staHull} rotation={[Math.PI / 2, 0, 0]} />
      {[0, 1, 2, 3].map((i) => {
        const a = (i * Math.PI) / 2;
        return (
          <mesh
            key={i}
            geometry={gArm}
            material={staDark}
            position={[Math.cos(a) * 0.56, 0, Math.sin(a) * 0.56]}
            rotation={[0, -a, 0]}
          />
        );
      })}
      <mesh geometry={gAnt} material={staHull} position={[0, 1.05, 0]} />
      <mesh geometry={gDot} material={staGlow} position={[0, 1.48, 0]} />
      <mesh geometry={gDot} material={staGlow} position={[1.12, 0, 0]} scale={0.7} />
    </group>
  );
}

/** Station : icone a taille-ecran constante quand on est loin ; bascule vers un MODELE
    3D (qui tourne lentement) quand la camera s'approche sous STATION_SWAP_DIST (LOD). */
export function Station({
  position,
  frac = 0.03,
  onClick,
}: {
  position: Vec3;
  frac?: number;
  onClick?: (e: ThreeEvent<MouseEvent>) => void;
}) {
  const spriteRef = useRef<THREE.Sprite>(null);
  const modelRef = useRef<THREE.Group>(null);
  const tex = useMemo(() => iconTexture("station"), []);
  const posV = useMemo(() => new THREE.Vector3(position[0], position[1], position[2]), [position]);
  const { camera } = useThree();
  useFrame(() => {
    const d = camera.position.distanceTo(posV);
    const near = d < STATION_SWAP_DIST;
    const fov = (camera as THREE.PerspectiveCamera).fov ?? 50;
    if (spriteRef.current) {
      spriteRef.current.visible = !near;
      if (!near) {
        const sc = screenScale(d, frac, fov);
        spriteRef.current.scale.set(sc, sc, 1);
      }
    }
    if (modelRef.current) {
      modelRef.current.visible = near;
      if (near) {
        const sc = screenScale(d, 0.028, fov);
        modelRef.current.scale.setScalar(sc);
        modelRef.current.rotation.y += 0.0035;
      }
    }
  });
  return (
    <group position={position} onClick={onClick}>
      <sprite ref={spriteRef}>
        <spriteMaterial map={tex} transparent depthTest />
      </sprite>
      <group ref={modelRef} visible={false}>
        <StationModelMeshes />
      </group>
    </group>
  );
}
