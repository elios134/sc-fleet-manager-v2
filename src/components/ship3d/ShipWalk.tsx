import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { PointerLockControls, useGLTF } from "@react-three/drei";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { MeshBVH, computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from "three-mesh-bvh";
import { MeshoptDecoder, type GLTFLoader } from "three-stdlib";
import type { TFunction } from "i18next";

/* Mode « Visite » : parcours 1re personne de l'intérieur d'un vaisseau, avec COLLISION
   (on marche sur les planchers, les murs bloquent). Générique sur toute la flotte :
   • SPAWN AUTO : raycast pour trouver la plus grande pièce (hauteur libre) et y poser le joueur.
   • PORTES franchissables (fermées de base dans l'export) : exclues de la collision + masquées.
   • DÉPLACEMENT VERTICAL ASSISTÉ (Espace/Shift) pour les échelles et le multi-pont.
   Collision capsule vs BVH (three-mesh-bvh). Le maillage est quantifié (KHR_mesh_quantization
   via meshopt) → on lit chaque sommet dé-normalisé puis matrice monde avant de fusionner. */

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const RADIUS = 0.3;
const HEIGHT = 1.75;
const EYE = 1.62;
const GRAVITY = -28;
const SPEED = 4.5;
const CLIMB = 3.5; // vitesse de montée/descente assistée (échelles / multi-pont)
const SUBSTEPS = 5;
const BASE_FOV = 75; // fov normal (doit matcher la caméra du Canvas)
const MIN_FOV = 15; // zoom max (F + molette)

// Portes/vantaux/hatches franchissables en visite (fermés de base), hors murs/cadres structurels.
const isPassable = (name: string) => /door|hatch|bulkhead/i.test(name) && !/wall|frame/i.test(name);
// Primitives orphelines (artefacts d'export : Box204…) → masquées + hors collision.
const isStray = (name: string) => /^(box|cube|plane|cylinder|sphere|cone|circle|icosphere|object|empty)[._]?\d+$/i.test(name);
// Meshes exclus du rendu et de la collision en visite.
const isSkipped = (name: string) => isPassable(name) || isStray(name);

function isMesh(o: THREE.Object3D): o is THREE.Mesh {
  return (o as THREE.Mesh).isMesh === true;
}

// Collider BVH monde à partir du modèle. Gère la quantification meshopt (positions Int16
// normalisées) : lecture dé-normalisée (fromBufferAttribute) puis matrice monde → mètres.
// Exclut les portes franchissables.
function buildCollider(scene: THREE.Object3D): THREE.Mesh {
  scene.updateMatrixWorld(true);
  const geos: THREE.BufferGeometry[] = [];
  const v = new THREE.Vector3();
  scene.traverse((o) => {
    if (!isMesh(o) || !o.geometry?.attributes.position || isSkipped(o.name)) return;
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
  merged.computeBoundingBox();
  merged.boundsTree = new MeshBVH(merged);
  const collider = new THREE.Mesh(merged);
  collider.visible = false;
  return collider;
}

// Vide vertical mini pour valider un plancher « debout » (m). Calé sur la métrique de surface
// praticable d'asset-3d (≥ 1,8 m) → garantit qu'un spawn valide existe dans tout habitacle.
const MIN_HEADROOM = 1.8;

// Cherche un plancher où l'on TIENT DEBOUT (vide vertical ≥ MIN_HEADROOM au-dessus → jamais
// encastré dans un mur/siège) dans une petite grille autour de (cx,cz). Biaise vers la proximité
// de (cx,cz) et, si fourni, d'une altitude cible `preferY` (le pont du siège pilote). null = rien.
function findFloorNear(collider: THREE.Mesh, cx: number, cz: number, preferY?: number): THREE.Vector3 | null {
  const bb = collider.geometry.boundingBox!;
  const target = preferY ?? (bb.min.y + bb.max.y) / 2;
  const rc = new THREE.Raycaster();
  rc.firstHitOnly = false;
  const far = bb.max.y - bb.min.y + 5;
  const OFF = [
    [0, 0], [0.8, 0], [-0.8, 0], [0, 0.8], [0, -0.8],
    [0.8, 0.8], [-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8],
    [1.6, 0], [-1.6, 0], [0, 1.6], [0, -1.6],
  ];
  let best: { x: number; y: number; z: number; score: number } | null = null;
  for (const [dx, dz] of OFF) {
    const x = cx + dx, z = cz + dz;
    if (x < bb.min.x || x > bb.max.x || z < bb.min.z || z > bb.max.z) continue;
    rc.set(new THREE.Vector3(x, bb.max.y + 2, z), new THREE.Vector3(0, -1, 0));
    rc.far = far;
    const ys = rc.intersectObject(collider, true).map((h) => h.point.y).sort((a, b) => b - a);
    for (let i = 0; i < ys.length - 1; i++) {
      const gap = ys[i] - ys[i + 1];
      if (gap < MIN_HEADROOM) continue;
      const floorY = ys[i + 1];
      // Pièce haute + colonne proche de (cx,cz) + plancher proche de l'altitude cible.
      const score = gap - Math.hypot(dx, dz) * 0.5 - Math.abs(floorY - target) * 0.4;
      if (!best || score > best.score) best = { x, y: floorY, z, score };
    }
  }
  return best ? new THREE.Vector3(best.x, best.y + 0.1, best.z) : null;
}

function WalkModel({ url, keepMaterials = false }: { url: string; keepMaterials?: boolean }) {
  const { scene: gltfScene } = useGLTF(url, false, false, (loader: GLTFLoader) =>
    loader.setMeshoptDecoder(MeshoptDecoder()),
  );
  const { camera } = useThree();

  const { display, collider, standPos } = useMemo(() => {
    const display = gltfScene;
    display.traverse((o) => {
      if ((o as THREE.Light).isLight) o.visible = false;
      if (isMesh(o)) {
        if (isSkipped(o.name)) o.visible = false; // porte franchissable / primitive orpheline
        // keepMaterials : conserve les vrais matériaux/textures du .glb (test assets HD texturés)
        // au lieu du gris uni — mais en DOUBLE-FACE : beaucoup de « trous » vus de l'intérieur
        // sont en fait des faces simple-côté orientées vers l'extérieur (backface culling).
        if (!keepMaterials) {
          o.material = new THREE.MeshStandardMaterial({ color: 0x99a0ad, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
        } else {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m) => { m.side = THREE.DoubleSide; });
        }
      }
    });
    const collider = buildCollider(display);
    // SPAWN : debout, DANS le vaisseau, à côté du siège pilote. On s'ancre sur le marqueur
    // `hardpoint_seat_pilot` (toujours à l'intérieur) — surtout PAS sur les marqueurs d'accès
    // (`cockpitmount_outside`/`pilot_enter`/`seat_access`) qui sont des points d'entrée EXTÉRIEURS
    // (on grimpe depuis le sol) → faisaient spawn dehors sur beaucoup de vaisseaux.
    display.updateMatrixWorld(true);
    let seatPilot: THREE.Vector3 | null = null;
    display.traverse((o) => {
      if (!seatPilot && o.name === "hardpoint_seat_pilot") seatPilot = o.getWorldPosition(new THREE.Vector3());
    });
    if (!seatPilot) {
      display.traverse((o) => {
        const n = o.name || "";
        if (!seatPilot && /seat_pilot/i.test(n) && !/copilot/i.test(n)) seatPilot = o.getWorldPosition(new THREE.Vector3());
      });
    }
    // Plancher « debout » (vide vertical ≥ MIN_HEADROOM → jamais encastré) autour du siège ;
    // repli : centre de la bbox ; dernier repli : centre géométrique (ne bloque jamais le rendu).
    const sp = seatPilot as THREE.Vector3 | null;
    const bb = collider.geometry.boundingBox!;
    const cx = (bb.min.x + bb.max.x) / 2;
    const cz = (bb.min.z + bb.max.z) / 2;
    const standPos =
      (sp && findFloorNear(collider, sp.x, sp.z, sp.y)) ||
      findFloorNear(collider, cx, cz) ||
      new THREE.Vector3(cx, (bb.min.y + bb.max.y) / 2, cz);
    return { display, collider, standPos };
  }, [gltfScene, keepMaterials]);

  const player = useRef({ pos: standPos.clone(), vel: new THREE.Vector3(), onGround: false });
  const segment = useMemo(
    () => new THREE.Line3(new THREE.Vector3(0, RADIUS, 0), new THREE.Vector3(0, HEIGHT - RADIUS, 0)),
    [],
  );
  const input = useRef({ f: false, b: false, l: false, r: false, up: false, down: false });
  // Zoom « jumelles » : F MAINTENU + molette → resserre le fov (lissé dans useFrame).
  // Relâcher F → retour au fov normal.
  const zoom = useRef({ held: false, fov: BASE_FOV });

  // Lampe torche « casque » (touche T) : spot suivant la tête, décalé à droite comme une
  // lampe de casque militaire, pointant où on regarde. Position/cible recalées chaque frame.
  const torch = useMemo(() => {
    const l = new THREE.SpotLight(0xfff2d9, 60, 30, Math.PI / 6.5, 0.45, 1.5);
    l.visible = false;
    return l;
  }, []);

  useEffect(() => {
    player.current.pos.copy(standPos);
    player.current.vel.set(0, 0, 0);
    const map: Record<string, keyof typeof input.current> = {
      KeyW: "f", ArrowUp: "f", KeyZ: "f",
      KeyS: "b", ArrowDown: "b",
      KeyA: "l", ArrowLeft: "l", KeyQ: "l",
      KeyD: "r", ArrowRight: "r",
      Space: "up", ShiftLeft: "down", ShiftRight: "down", ControlLeft: "down",
    };
    const down = (e: KeyboardEvent) => {
      if (e.code === "KeyT") {
        torch.visible = !torch.visible; // T : lampe torche on/off
        e.preventDefault();
        return;
      }
      if (e.code === "KeyF") {
        zoom.current.held = true; // F maintenu : la molette zoome
        e.preventDefault();
        return;
      }
      const k = map[e.code];
      if (k) { input.current[k] = true; e.preventDefault(); }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "KeyF") {
        zoom.current.held = false;
        zoom.current.fov = BASE_FOV; // relâcher F → dézoom
        return;
      }
      const k = map[e.code];
      if (k) input.current[k] = false;
    };
    // passive:false → on peut bloquer le scroll de la page pendant le zoom.
    const wheel = (e: WheelEvent) => {
      if (!zoom.current.held) return;
      e.preventDefault();
      zoom.current.fov = THREE.MathUtils.clamp(zoom.current.fov + Math.sign(e.deltaY) * 6, MIN_FOV, BASE_FOV);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("wheel", wheel, { passive: false });
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("wheel", wheel);
    };
  }, [standPos, torch]);

  const tmp = useMemo(
    () => ({
      seg: new THREE.Line3(), box: new THREE.Box3(), mat: new THREE.Matrix4(),
      tp: new THREE.Vector3(), cp: new THREE.Vector3(),
      newStart: new THREE.Vector3(), delta: new THREE.Vector3(), oldStart: new THREE.Vector3(),
      fwd: new THREE.Vector3(), right: new THREE.Vector3(), wish: new THREE.Vector3(), dir: new THREE.Vector3(),
      torchOff: new THREE.Vector3(),
    }),
    [],
  );

  useFrame((_, rawDt) => {
    const dt = Math.min(0.05, rawDt);
    const p = player.current;
    const inp = input.current;

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
    // vertical : Espace = monter, Shift = descendre (échelles / multi-pont) ; sinon gravité.
    if (inp.up) p.vel.y = CLIMB;
    else if (inp.down) p.vel.y = -CLIMB;
    else p.vel.y += GRAVITY * dt;

    for (let i = 0; i < SUBSTEPS; i++) stepOnce(dt / SUBSTEPS);

    camera.position.copy(p.pos);
    camera.position.y += EYE;

    // Zoom lissé vers le fov cible (F + molette).
    const cam = camera as THREE.PerspectiveCamera;
    if (Math.abs(cam.fov - zoom.current.fov) > 0.05) {
      cam.fov = THREE.MathUtils.lerp(cam.fov, zoom.current.fov, Math.min(1, dt * 14));
      cam.updateProjectionMatrix();
    }

    // Lampe torche : suit la tête (décalage « épaule droite » en repère caméra) et pointe
    // dans la direction du regard.
    if (torch.visible) {
      tmp.torchOff.set(0.22, -0.04, 0).applyQuaternion(camera.quaternion);
      torch.position.copy(camera.position).add(tmp.torchOff);
      camera.getWorldDirection(tmp.dir);
      torch.target.position.copy(torch.position).addScaledVector(tmp.dir, 12);
      torch.target.updateMatrixWorld();
    }
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
    if (p.onGround && !input.current.up) {
      p.vel.y = 0;
    } else {
      tmp.delta.normalize();
      p.vel.addScaledVector(tmp.delta, -tmp.delta.dot(p.vel));
    }
    if (p.pos.y < collider.geometry.boundingBox!.min.y - 5) {
      p.pos.copy(standPos);
      p.vel.set(0, 0, 0);
    }
  }

  return (
    <>
      <primitive object={display} />
      <primitive object={collider} />
      <primitive object={torch} />
      <primitive object={torch.target} />
    </>
  );
}

export default function ShipWalk({
  modelUrl,
  t,
  onExit,
  keepMaterials = false,
}: {
  modelUrl: string;
  t: TFunction;
  onExit: () => void;
  keepMaterials?: boolean;
}) {
  return (
    // Wrapper et Canvas TRANSPARENTS : le fond de la scène est le vrai fond de l'app
    // (glow teinté + étoiles animées de Layout), visible à travers les trous des
    // intérieurs (pas étanches) — même ambiance que le reste de l'app.
    <div className="absolute inset-0 z-20">
      <Canvas camera={{ fov: 75, near: 0.03, far: 3000, position: [0, 0, 6] }}>
        <hemisphereLight args={["#e6e9ff", "#2a2a35", 1.1]} />
        <ambientLight intensity={0.35} />
        <directionalLight position={[2, 4, 2]} intensity={1.0} />
        <Suspense fallback={null}>
          <WalkModel url={modelUrl} keepMaterials={keepMaterials} />
        </Suspense>
        <PointerLockControls onUnlock={onExit} />
      </Canvas>

      <div className="pointer-events-none absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/70" />

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
