import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { PointerLockControls, useGLTF } from "@react-three/drei";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { MeshBVH, computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from "three-mesh-bvh";
import { MeshoptDecoder, type GLTFLoader } from "three-stdlib";
import type { TFunction } from "i18next";

/* Mode « Visite » : parcours 1re personne de l'intérieur d'un vaisseau, avec COLLISION
   (on marche sur les planchers, les murs bloquent, gravité) — niveau 2.
   Collision : capsule vs BVH du maillage (three-mesh-bvh). Validé au harnais debug3d/walk.html.
   Le modèle est rendu à l'échelle native (1 unité ≈ 1 m) — pas de cadrage auto ici. */

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const RADIUS = 0.3;
const HEIGHT = 1.75;
const EYE = 1.62;
const GRAVITY = -28;
const SPEED = 4.5;
const JUMP = 8.5;
const SUBSTEPS = 5;
// Spawn par défaut : dans la soute du Cutlass (plancher ~ -2.95). Ajustable par vaisseau si besoin.
const SPAWN = new THREE.Vector3(0, -2, 6);
// Portes intérieures franchissables en visite (fermées de base dans le modèle) : exclues de la
// collision + masquées, sinon on reste bloqué dans une pièce (ex. accès cockpit du Cutlass).
const PASSABLE = /door_bulkhead/i;

function isMesh(o: THREE.Object3D): o is THREE.Mesh {
  return (o as THREE.Mesh).isMesh === true;
}

// Construit un collider BVH monde à partir du modèle chargé. Gère la quantification meshopt
// (positions Int16 normalisées) : on lit chaque sommet dé-normalisé puis on applique la matrice
// monde (→ mètres réels), sinon applyMatrix4 écrase tout dans [-1,1].
function buildCollider(scene: THREE.Object3D): THREE.Mesh {
  scene.updateMatrixWorld(true);
  const geos: THREE.BufferGeometry[] = [];
  const v = new THREE.Vector3();
  scene.traverse((o) => {
    if (!isMesh(o) || !o.geometry?.attributes.position) return;
    if (PASSABLE.test(o.name)) return; // portes franchissables : hors collision
    const src = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
    const pos = src.attributes.position;
    const arr = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      arr[i * 3] = v.x;
      arr[i * 3 + 1] = v.y;
      arr[i * 3 + 2] = v.z;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    geos.push(g);
  });
  const merged = mergeGeometries(geos, false);
  merged.boundsTree = new MeshBVH(merged);
  const collider = new THREE.Mesh(merged);
  collider.visible = false;
  return collider;
}

function WalkModel({ url }: { url: string }) {
  const { scene: gltfScene } = useGLTF(url, false, false, (loader: GLTFLoader) =>
    loader.setMeshoptDecoder(MeshoptDecoder()),
  );
  const { camera } = useThree();

  const { display, collider } = useMemo(() => {
    const display = gltfScene;
    display.traverse((o) => {
      if ((o as THREE.Light).isLight) o.visible = false;
      if (isMesh(o)) {
        if (PASSABLE.test(o.name)) o.visible = false; // porte franchissable → masquée (embrasure ouverte)
        o.material = new THREE.MeshStandardMaterial({ color: 0x99a0ad, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
      }
    });
    return { display, collider: buildCollider(display) };
  }, [gltfScene]);

  // état joueur (feet) + capsule (centres de sphères à y=RADIUS et y=HEIGHT-RADIUS)
  const player = useRef({ pos: SPAWN.clone(), vel: new THREE.Vector3(), onGround: false });
  const segment = useMemo(
    () => new THREE.Line3(new THREE.Vector3(0, RADIUS, 0), new THREE.Vector3(0, HEIGHT - RADIUS, 0)),
    [],
  );
  const input = useRef({ f: false, b: false, l: false, r: false, jump: false });

  useEffect(() => {
    player.current.pos.copy(SPAWN);
    player.current.vel.set(0, 0, 0);
    const map: Record<string, keyof typeof input.current> = {
      KeyW: "f", ArrowUp: "f", KeyZ: "f",
      KeyS: "b", ArrowDown: "b",
      KeyA: "l", ArrowLeft: "l", KeyQ: "l",
      KeyD: "r", ArrowRight: "r",
      Space: "jump",
    };
    const down = (e: KeyboardEvent) => { const k = map[e.code]; if (k) { input.current[k] = true; e.preventDefault(); } };
    const up = (e: KeyboardEvent) => { const k = map[e.code]; if (k) input.current[k] = false; };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, []);

  const tmp = useMemo(
    () => ({
      seg: new THREE.Line3(), box: new THREE.Box3(), mat: new THREE.Matrix4(),
      tp: new THREE.Vector3(), cp: new THREE.Vector3(),
      newStart: new THREE.Vector3(), delta: new THREE.Vector3(), oldStart: new THREE.Vector3(),
      fwd: new THREE.Vector3(), right: new THREE.Vector3(), wish: new THREE.Vector3(), dir: new THREE.Vector3(),
    }),
    [],
  );

  useFrame((_, rawDt) => {
    const dt = Math.min(0.05, rawDt);
    const p = player.current;
    const inp = input.current;

    // base horizontale depuis le regard caméra (PointerLockControls gère la rotation)
    camera.getWorldDirection(tmp.dir);
    tmp.fwd.set(tmp.dir.x, 0, tmp.dir.z);
    if (tmp.fwd.lengthSq() < 1e-6) tmp.fwd.set(0, 0, -1);
    tmp.fwd.normalize();
    tmp.right.crossVectors(tmp.fwd, camera.up).normalize();
    tmp.wish.set(0, 0, 0);
    tmp.wish.addScaledVector(tmp.fwd, (inp.f ? 1 : 0) - (inp.b ? 1 : 0));
    tmp.wish.addScaledVector(tmp.right, (inp.r ? 1 : 0) - (inp.l ? 1 : 0));
    if (tmp.wish.lengthSq() > 0) tmp.wish.normalize().multiplyScalar(SPEED);
    p.vel.x = tmp.wish.x;
    p.vel.z = tmp.wish.z;
    p.vel.y += GRAVITY * dt;
    if (inp.jump && p.onGround) { p.vel.y = JUMP; p.onGround = false; }

    for (let i = 0; i < SUBSTEPS; i++) stepOnce(dt / SUBSTEPS);

    camera.position.copy(p.pos);
    camera.position.y += EYE;
  });

  function stepOnce(dt: number) {
    const p = player.current;
    p.pos.addScaledVector(p.vel, dt);

    tmp.oldStart.copy(segment.start).add(p.pos);
    tmp.mat.copy(collider.matrixWorld).invert();
    tmp.seg.copy(segment);
    tmp.seg.start.add(p.pos).applyMatrix4(tmp.mat);
    tmp.seg.end.add(p.pos).applyMatrix4(tmp.mat);
    tmp.box.makeEmpty();
    tmp.box.expandByPoint(tmp.seg.start);
    tmp.box.expandByPoint(tmp.seg.end);
    tmp.box.min.addScalar(-RADIUS);
    tmp.box.max.addScalar(RADIUS);

    const bvh = collider.geometry.boundsTree;
    if (bvh) {
      bvh.shapecast({
        intersectsBounds: (b) => b.intersectsBox(tmp.box),
        intersectsTriangle: (tri) => {
          const dist = tri.closestPointToSegment(tmp.seg, tmp.tp, tmp.cp);
          if (dist < RADIUS) {
            const depth = RADIUS - dist;
            tmp.cp.sub(tmp.tp).normalize();
            tmp.seg.start.addScaledVector(tmp.cp, depth);
            tmp.seg.end.addScaledVector(tmp.cp, depth);
          }
          return false;
        },
      });
    }

    tmp.newStart.copy(tmp.seg.start).applyMatrix4(collider.matrixWorld);
    tmp.delta.subVectors(tmp.newStart, tmp.oldStart);
    const offset = Math.max(0, tmp.delta.length() - 1e-5);
    tmp.delta.normalize().multiplyScalar(offset);

    p.onGround = tmp.delta.y > Math.abs(dt * p.vel.y * 0.25);
    p.pos.add(tmp.delta);
    if (p.onGround) {
      p.vel.y = 0;
    } else {
      tmp.delta.normalize();
      p.vel.addScaledVector(tmp.delta, -tmp.delta.dot(p.vel));
    }
    if (p.pos.y < -40) { p.pos.copy(SPAWN); p.vel.set(0, 0, 0); }
  }

  return (
    <>
      <primitive object={display} />
      <primitive object={collider} />
    </>
  );
}

export default function ShipWalk({
  modelUrl,
  t,
  onExit,
}: {
  modelUrl: string;
  t: TFunction;
  onExit: () => void;
}) {
  return (
    <div className="absolute inset-0 z-20 bg-black">
      <Canvas camera={{ fov: 75, near: 0.03, far: 3000, position: [0, 0, 6] }}>
        <hemisphereLight args={["#e6e9ff", "#2a2a35", 1.1]} />
        <ambientLight intensity={0.35} />
        <directionalLight position={[2, 4, 2]} intensity={1.0} />
        <Suspense fallback={null}>
          <WalkModel url={modelUrl} />
        </Suspense>
        {/* clic = verrouille la souris ; ESC = déverrouille → on sort de la visite */}
        <PointerLockControls onUnlock={onExit} />
      </Canvas>

      {/* réticule */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/70" />

      {/* aide + sortie */}
      <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
        <div className="rounded-full bg-black/60 px-4 py-1.5 text-xs text-white/80 backdrop-blur">
          {t("ship3d.walkHint")}
        </div>
      </div>
      <button
        onClick={onExit}
        className="absolute right-4 top-4 z-30 rounded-lg bg-white/10 px-3 py-1.5 text-xs text-white/80 hover:bg-white/20"
      >
        {t("ship3d.walkExit")}
      </button>
    </div>
  );
}
