import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { LightGrid, type ShipLightDef } from "../../lib/ship3dLights";

/* ÉCLAIRAGE EMBARQUÉ (sidecar lumières asset-3d) : les vraies lumières du vaisseau (plafonniers,
   appliques…) issues des KHR_lights_punctual de l'export — strippées du .glb (~2000 sur un Carrack,
   three.js ne survit pas) et livrées en JSON à côté. On n'allume qu'un POOL FIXE de lumières three.js
   RÉUTILISÉES (jamais de create/destroy par frame → pas de recompilation shader) : les N plus utiles
   autour du joueur, re-sélectionnées quand il se déplace (grille spatiale, cf. ship3dLights.ts). */
const POOL_POINT = 8;
const POOL_SPOT = 8;
const LIGHT_RADIUS = 18; // m — rayon de sélection autour du joueur
const LIGHT_GAIN = 1.0; // gain global sur les candela source (calibré au harnais sur le Cutlass)
// Plafond par lumière : la source monte à 75 000 cd (p50=300, p95≈5-10k) → sans plafond ça crame.
// Calibré visuellement (debug3d/lights-calib.html) : 120 = trop bridé (quasi invisible),
// 600 = flaques de lumière chaudes et lisibles, 1500+ = sol sur-exposé.
const LIGHT_MAX_CD = 600;
const REPICK_DIST = 1.0; // m — re-sélection quand le joueur a bougé d'autant
const REPICK_SECS = 0.5; // …ou au plus tard toutes les X s (lumières à portée après téléport, etc.)

export function ShipLights({ lights }: { lights: ShipLightDef[] }) {
  const { camera } = useThree();
  const grid = useMemo(() => new LightGrid(lights), [lights]);
  const pool = useMemo(() => {
    const points = Array.from({ length: POOL_POINT }, () => {
      const l = new THREE.PointLight(0xffffff, 0, 1, 2);
      l.visible = false;
      return l;
    });
    const spots = Array.from({ length: POOL_SPOT }, () => {
      const l = new THREE.SpotLight(0xffffff, 0, 1, Math.PI / 4, 0.5, 2);
      l.visible = false;
      return l;
    });
    return { points, spots };
  }, []);
  const last = useRef({ pos: new THREE.Vector3(Infinity, Infinity, Infinity), t: 0 });

  useFrame((_, dt) => {
    const l = last.current;
    l.t += dt;
    if (camera.position.distanceToSquared(l.pos) < REPICK_DIST * REPICK_DIST && l.t < REPICK_SECS) return;
    l.pos.copy(camera.position);
    l.t = 0;
    const { points, spots } = grid.nearest(
      camera.position.x, camera.position.y, camera.position.z,
      POOL_POINT, POOL_SPOT, LIGHT_RADIUS,
    );
    pool.points.forEach((pl, i) => {
      const def = points[i];
      if (!def) { pl.visible = false; return; }
      pl.position.set(def.pos[0], def.pos[1], def.pos[2]);
      pl.color.setRGB(def.color[0], def.color[1], def.color[2]); // couleurs source déjà linéaires
      pl.intensity = Math.min(def.intensity * LIGHT_GAIN, LIGHT_MAX_CD);
      pl.distance = Math.min(def.range > 0 ? def.range : LIGHT_RADIUS, LIGHT_RADIUS * 1.5);
      pl.visible = true;
    });
    pool.spots.forEach((sl, i) => {
      const def = spots[i];
      if (!def) { sl.visible = false; return; }
      sl.position.set(def.pos[0], def.pos[1], def.pos[2]);
      sl.color.setRGB(def.color[0], def.color[1], def.color[2]);
      sl.intensity = Math.min(def.intensity * LIGHT_GAIN, LIGHT_MAX_CD);
      sl.distance = Math.min(def.range > 0 ? def.range : LIGHT_RADIUS, LIGHT_RADIUS * 1.5);
      const outer = def.outerConeAngle ?? Math.PI / 4;
      sl.angle = Math.min(outer, Math.PI / 2 - 0.01);
      sl.penumbra = def.innerConeAngle != null && outer > 0 ? 1 - Math.min(def.innerConeAngle / outer, 1) : 0.5;
      const d = def.dir ?? [0, -1, 0]; // dir monde normalisée (-Z KHR appliqué côté export)
      sl.target.position.set(def.pos[0] + d[0], def.pos[1] + d[1], def.pos[2] + d[2]);
      sl.target.updateMatrixWorld();
      sl.visible = true;
    });
  });

  return (
    <>
      {pool.points.map((l, i) => (
        <primitive key={`pt${i}`} object={l} />
      ))}
      {pool.spots.map((l, i) => (
        <group key={`sp${i}`}>
          <primitive object={l} />
          <primitive object={l.target} />
        </group>
      ))}
    </>
  );
}
