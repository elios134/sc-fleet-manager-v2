import { useEffect, useMemo, useState } from "react";
import { type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { type Vec3 } from "./placement";
import { bodyTexture, starGlowTexture, textureKindFor } from "./textures";
import { texUrlFor } from "./naming";

// Stations / marqueurs déplacés dans stations.tsx (ré-exportés pour les scènes).
export { IconSprite, BodyLabel, Station } from "./stations";
const SYS_LIGHT = 4000;


export function StarSphere({
  position,
  radius,
  color = "#fff4dd",
  lit = true,
}: {
  position: Vec3;
  radius: number;
  color?: string;
  /** Calque Éclairage : la lumière de l'étoile éclaire les corps (côté jour / nuit). */
  lit?: boolean;
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
      <pointLight intensity={lit ? 2.2 : 0} distance={SYS_LIGHT} decay={0} />
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

// Cache module des textures CDN (clé = URL). Partagé, jamais disposé — comme iconCache /
// bodyTexture : borné par le nombre de corps distincts, pas par le nombre de navigations.
const cdnTexCache = new Map<string, THREE.Texture>();

/** Globe texturé : charge la vraie texture équirect depuis le CDN (jsDelivr sert avec CORS,
    donc crossOrigin='anonymous' suffit pour WebGL). Repli immédiat sur la texture procédurale
    (jamais de globe noir) si 404 / hors-ligne / CORS refusé. */
export function TexturedPlanet({
  position,
  radius,
  name,
  appearance,
  habitable,
  isMoon,
  selected,
  onClick,
}: {
  position: Vec3;
  radius: number;
  name: string;
  appearance: string | null;
  habitable: number | null;
  isMoon: boolean;
  selected: boolean;
  onClick: (e: ThreeEvent<MouseEvent>) => void;
}) {
  const fallback = useMemo(() => bodyTexture(textureKindFor(appearance)), [appearance]);
  const [map, setMap] = useState<THREE.Texture>(fallback);
  useEffect(() => {
    const url = texUrlFor(name);
    // Cache par URL (cf. spec §6) : une texture CDN n'est téléchargée et décodée qu'UNE fois ;
    // partagée entre (re)montages, donc aucune texture orpheline au changement de système.
    const cached = cdnTexCache.get(url);
    if (cached) {
      setMap(cached);
      return;
    }
    setMap(fallback);
    let alive = true;
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    loader.load(
      url,
      (tx) => {
        tx.colorSpace = THREE.SRGBColorSpace;
        tx.anisotropy = 4;
        cdnTexCache.set(url, tx);
        if (alive) setMap(tx);
      },
      undefined,
      () => {
        /* 404 / hors-ligne / CORS → on garde le procédural */
      },
    );
    return () => {
      alive = false;
    };
  }, [name, fallback]);
  return (
    <group position={position}>
      <mesh onClick={onClick}>
        <sphereGeometry args={[radius, isMoon ? 24 : 48, isMoon ? 16 : 32]} />
        <meshStandardMaterial
          map={map}
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
