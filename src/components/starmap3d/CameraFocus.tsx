import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Vec3 } from "./placement";

/* Contrôleur de caméra : vol animé (ease-in-out) vers une cible cliquée. Se cale sur les
   OrbitControls par défaut (makeDefault) — anime `controls.target` ET la position caméra
   (en conservant la direction de vue courante, à la distance `dist`). Partagé Starmap 3D
   (onglet) + carte du GPS trading. */

export type FocusTarget = { pos: Vec3; dist: number; nonce: number };

type Ctrls = { target: THREE.Vector3; update: () => void };

export function CameraFocus({ target }: { target: FocusTarget | null }) {
  const { camera, controls } = useThree();
  const anim = useRef<{
    camFrom: THREE.Vector3;
    camTo: THREE.Vector3;
    tgtFrom: THREE.Vector3;
    tgtTo: THREE.Vector3;
    t: number;
  } | null>(null);

  useEffect(() => {
    const ctrls = controls as unknown as Ctrls | null;
    if (!target || !ctrls) return;
    const tgt = new THREE.Vector3(target.pos[0], target.pos[1], target.pos[2]);
    const dir = new THREE.Vector3().subVectors(camera.position, ctrls.target);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0.6, 1);
    dir.normalize();
    const camTo = new THREE.Vector3().copy(tgt).addScaledVector(dir, target.dist);
    anim.current = { camFrom: camera.position.clone(), camTo, tgtFrom: ctrls.target.clone(), tgtTo: tgt, t: 0 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  useFrame((_, dt) => {
    const a = anim.current;
    const ctrls = controls as unknown as Ctrls | null;
    if (!a || !ctrls) return;
    a.t = Math.min(1, a.t + dt * 2.4); // ~0.4 s
    const e = a.t < 0.5 ? 2 * a.t * a.t : 1 - Math.pow(-2 * a.t + 2, 2) / 2; // easeInOutQuad
    camera.position.lerpVectors(a.camFrom, a.camTo, e);
    ctrls.target.lerpVectors(a.tgtFrom, a.tgtTo, e);
    ctrls.update();
    if (a.t >= 1) anim.current = null;
  });

  return null;
}
