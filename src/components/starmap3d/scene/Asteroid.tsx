import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Vec3 } from "../placement";

// Astéroïde procédural (Delamar/Levski) : icosaèdre bruité + cratère creusé, couleurs par
// sommet. Aucun asset ni texture réelle (corps irrégulier). Géométrie construite une fois.
function buildAsteroidGeo(): THREE.IcosahedronGeometry {
  const g = new THREE.IcosahedronGeometry(1, 5);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const crater = new THREE.Vector3(1, 0.22, 0.36).normalize();
  const cDark = new THREE.Color(0x36302a);
  const cMid = new THREE.Color(0x6e645a);
  const cLight = new THREE.Color(0x968a7a);
  const cCrater = new THREE.Color(0x0b0809);
  const cols: number[] = [];
  const tmp = new THREE.Color();
  const noise = (x: number, y: number, z: number) =>
    0.5 + 0.25 * Math.sin(x * 3.1 + y * 1.7) + 0.15 * Math.sin(y * 5.3 + z * 2.1 + 1) + 0.1 * Math.sin(z * 8.7 + x * 4.2 + 2);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    nrm.copy(v).normalize();
    const bump =
      0.18 * Math.sin(nrm.x * 5 + 1.3) * Math.cos(nrm.y * 4.3 + 2.1) +
      0.1 * Math.sin(nrm.z * 9 + 0.7) * Math.cos(nrm.x * 7) +
      0.06 * Math.sin(nrm.y * 15 + nrm.z * 12);
    let r = 1 + bump;
    let inC = 0;
    const d = nrm.dot(crater);
    if (d > 0.78) {
      const tt = (d - 0.78) / 0.22;
      inC = tt;
      r -= 0.7 * tt * tt;
    }
    v.copy(nrm).multiplyScalar(r);
    pos.setXYZ(i, v.x, v.y, v.z);
    let nz = noise(nrm.x * 2, nrm.y * 2, nrm.z * 2);
    nz = nz < 0 ? 0 : nz > 1 ? 1 : nz;
    tmp.copy(cDark).lerp(cMid, nz);
    if (nz > 0.62) tmp.lerp(cLight, ((nz - 0.62) / 0.38) * 0.8);
    if (inC > 0) tmp.lerp(cCrater, Math.min(1, inC * 1.5));
    cols.push(tmp.r, tmp.g, tmp.b);
  }
  g.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
  g.computeVertexNormals();
  return g;
}
const ASTEROID_GEO = buildAsteroidGeo();

export function Asteroid({ position, radius }: { position: Vec3; radius: number }) {
  const ref = useRef<THREE.Mesh>(null);
  const mat = useMemo(
    () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }),
    [],
  );
  useFrame(() => {
    if (ref.current) ref.current.rotation.y += 0.0025;
  });
  return <mesh ref={ref} geometry={ASTEROID_GEO} material={mat} position={position} scale={radius} />;
}
