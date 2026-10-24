import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { extendShipLoader } from "./shipLoader";
import { deblackenMaterial, clayMaterial, sharpenTextures, simplifyGlass } from "./materialFix";
import { RADIUS, HEIGHT, EYE, GRAVITY, SPEED, CLIMB, SUBSTEPS, BASE_FOV, MIN_FOV, CHUNK_BUBBLE_R, CHUNK_REPICK_DIST, isSkippedTree, isDoorTree, isOccluderTree, isCollisionTree, isHullTree, cullOutsideHull, isMesh, buildCollider, findFloorNear, findClearSpawn, findOpenFloor } from "./walkPhysics";

export function WalkModel({
  url,
  keepMaterials = false,
}: {
  url: string;
  keepMaterials?: boolean;
}) {
  const { camera, gl, scene } = useThree();
  const { scene: gltfScene } = useGLTF(url, false, false, extendShipLoader(gl));

  const { display, collider, standPos, chunks } = useMemo(() => {
    const display = gltfScene;
    // Chunks du pipeline « moteur » (nœuds `chunk_<gx>_<gy>_<gz>`, grille 10 m). Leur présence
    // bascule le MODE CHUNKÉ : portes rendues, cull géométrique désactivé (asset-3d cull au build),
    // matrices statiques + bulle de culling par frame. Absent = ancien pipeline (comportement inchangé).
    const chunkRoots: THREE.Object3D[] = [];
    let hasHull = false;
    display.traverse((o) => {
      if (/^chunk_/i.test(o.name || "")) chunkRoots.push(o);
      if (/collision_hull/i.test(o.name || "")) hasHull = true; // cf. isHullTree : bascule le collider en mode hull
    });
    const hasChunks = chunkRoots.length > 0;
    // Emprise de la couche collision (spawn quand `hardpoint_seat_pilot` a été retiré au nettoyage :
    // on cherche la zone la plus dégagée de collision_walk, cf. findOpenFloor).
    const walkBox = new THREE.Box3();
    let walkCount = 0;
    display.traverse((o) => {
      if ((o as THREE.Light).isLight) { o.visible = false; return; }
      if (!isMesh(o)) return;
      if (isCollisionTree(o)) {
        // Couche collision (walk / floor_patch / hull) : invisible + collision uniquement. On accumule
        // l'emprise des PLANCHERS (walk/floor_patch) pour le spawn — mais PAS celle du hull, dont la bbox
        // = la coque entière (murs compris) ferait échantillonner findOpenFloor sur tout le vaisseau.
        if (!isHullTree(o)) {
          const cb = new THREE.Box3().setFromObject(o, true);
          if (!cb.isEmpty()) { walkBox.union(cb); walkCount++; }
        }
        o.visible = false;
        o.userData.colliderOnly = true;
        return;
      }
      if (isSkippedTree(o)) {
        // Pipeline chunké : les PORTES sont RENDUES (repère résine ; collision skippée via
        // buildCollider) ; les primitives orphelines restent masquées. Sinon (ancien) : tout masqué.
        if (hasChunks && isDoorTree(o)) {
          if (!keepMaterials) {
            o.material = clayMaterial();
          } else {
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            mats.forEach((m) => { m.side = THREE.DoubleSide; deblackenMaterial(m); sharpenTextures(m, gl.capabilities.getMaxAnisotropy()); });
          }
        } else {
          o.visible = false;
        }
        return;
      }
      if (isOccluderTree(o)) {
        // Shell occulteur : gardé VISIBLE (backdrop des trous, coque vue de l'intérieur/extérieur)
        // + hors collision (containment = murs + collision_walk, pas le shell).
        if (!keepMaterials) {
          // Mode « résine » : le shell aussi en matcap clay → cohérence (sinon coque texturée +
          // intérieur clay = mélange).
          o.material = clayMaterial();
        } else {
          // HD : conserve SON matériau (texture de coque) mais MATIFIE. Les matériaux du shell sont
          // les matériaux extérieurs CIG (roughness ~0.08) → vus de l'intérieur non éclairés ils
          // rendent « noir mouillé » brillant (la « porte noire »). Clamp roughness ≥ 0.6 → mat,
          // lisible sous l'IBL + casque. DoubleSide car on en voit la face interne.
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m) => {
            const sm = m as THREE.MeshStandardMaterial;
            sm.side = THREE.DoubleSide;
            if ("roughness" in sm) sm.roughness = Math.max(sm.roughness ?? 1, 0.6);
            if ("metalness" in sm) sm.metalness = Math.min(sm.metalness ?? 0, 0.1);
            deblackenMaterial(sm); // coque ext à facteur ~noir (Gama) vue en backdrop → lisible
            sm.needsUpdate = true;
          });
        }
        return;
      }
      // keepMaterials : conserve les vrais matériaux/textures du .glb — mais en DOUBLE-FACE : beaucoup
      // de « trous » vus de l'intérieur sont des faces simple-côté orientées vers l'extérieur.
      // Sinon (mode « visite résine ») : matcap clay uniforme, non éclairé (jamais cramé, relief lisible).
      if (!keepMaterials) {
        o.material = clayMaterial();
      } else {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => { m.side = THREE.DoubleSide; deblackenMaterial(m); simplifyGlass(m); sharpenTextures(m, gl.capabilities.getMaxAnisotropy()); });
      }
    });
    // Retire les modules mal placés (débordant de la coque = shell occulteur) AVANT de construire le
    // collider → ils ne bloquent plus et disparaissent du rendu. Fleet-wide, sans nommage.
    // SEULEMENT en non-chunké : le pipeline chunké cull déjà au build, et parcourir 16k meshes en
    // precise=true serait bien trop lent.
    if (!hasChunks) cullOutsideHull(display);
    const collider = buildCollider(display, hasHull);
    // SPAWN : debout, DANS le vaisseau, à côté du siège pilote. On s'ancre sur le marqueur
    // `hardpoint_seat_pilot` (toujours à l'intérieur) — surtout PAS sur les marqueurs d'accès
    // (`cockpitmount_outside`/`pilot_enter`/`seat_access`) qui sont des points d'entrée EXTÉRIEURS
    // (on grimpe depuis le sol) → faisaient spawn dehors sur beaucoup de vaisseaux.
    display.updateMatrixWorld(true);
    // `spawn_point` (pivot clay) : nœud vide posé au meilleur endroit par le pipeline → ancre
    // prioritaire (le pipeline connaît la vraie topologie mieux que findOpenFloor).
    let spawnMarker: THREE.Vector3 | null = null;
    let seatPilot: THREE.Vector3 | null = null;
    display.traverse((o) => {
      if (!spawnMarker && /(^|_)spawn_point/i.test(o.name || "")) spawnMarker = o.getWorldPosition(new THREE.Vector3());
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
    // Ancre de spawn, par ordre de fiabilité : `spawn_point` du pipeline (clay) → siège pilote (HD)
    // → zone dégagée de collision_walk (clay sans spawn_point) → centre bbox → centre géométrique.
    // Candidats de spawn (spawn_point du pipeline puis siège pilote HD), posés au sol. Chacun n'est
    // retenu que si la capsule N'EST PAS ENCASTRÉE (capsuleEmbedded) — sur les capitaux le spawn_point
    // tombe parfois dans une cloison (bug « spawn dans les murs »). Sinon → findOpenFloor (zone la plus
    // dégagée = jamais encastrée), calculé PARESSEUSEMENT (dans la chaîne || → aucun coût si un
    // candidat passe). Derniers replis : centre bbox, centre géométrique (ne bloque jamais le rendu).
    // Spawn : ancré sur `spawn_point` (pipeline) puis siège pilote (HD), via findClearSpawn qui
    // GARANTIT un point non-encastré (le spawn_point tombe parfois dans une cloison sur les capitaux
    // = bug « spawn dans les murs »). Replis : findOpenFloor sur l'emprise collision_walk (rare : ni
    // spawn_point ni siège dégagés), puis centre bbox, puis centre géométrique (ne bloque jamais).
    const sm = spawnMarker as THREE.Vector3 | null;
    let standPos: THREE.Vector3 | null =
      (sm && findClearSpawn(collider, sm)) || (sp && findClearSpawn(collider, sp)) || null;
    if (!standPos && walkCount > 0) standPos = findOpenFloor(collider, walkBox);
    if (!standPos) standPos = findFloorNear(collider, cx, cz) || new THREE.Vector3(cx, (bb.min.y + bb.max.y) / 2, cz);
    // Chunks : Box3 (culling bulle ; non-precise = conservateur, on préfère sur-inclure que popper)
    // + matrices STATIQUES (géo world-baked fixe → three.js ne recalcule plus les matrices des 16k
    // objets par frame, gros gain CPU — cf. bench 38→71 FPS rien qu'avec ça).
    const chunks = hasChunks
      ? chunkRoots.map((node) => ({ node, box: new THREE.Box3().setFromObject(node) }))
      : [];
    if (hasChunks) {
      display.matrixWorldAutoUpdate = false;
      display.traverse((o) => { o.matrixAutoUpdate = false; });
    }
    return { display, collider, standPos, chunks };
  }, [gltfScene, keepMaterials]);

  // PRÉCOMPILATION de tous les matériaux dès l'entrée : three.js
  // compile sinon chaque matériau à sa première apparition à l'écran → en texturé (~94 programmes,
  // compilation D3D lente sous Windows) on gelait en avançant. Une seule attente, au chargement.
  useEffect(() => {
    gl.compile(scene, camera);
  }, [gl, scene, camera, display]);

  const player = useRef({ pos: standPos.clone(), vel: new THREE.Vector3(), onGround: false });
  const segment = useMemo(
    () => new THREE.Line3(new THREE.Vector3(0, RADIUS, 0), new THREE.Vector3(0, HEIGHT - RADIUS, 0)),
    [],
  );
  const input = useRef({ f: false, b: false, l: false, r: false, up: false, down: false });
  // Zoom « jumelles » : F MAINTENU + molette → resserre le fov (lissé dans useFrame).
  // Relâcher F → retour au fov normal.
  const zoom = useRef({ held: false, fov: BASE_FOV });
  // Mode « vol libre » (fantôme) : mode PAR DÉFAUT de la Visite → on traverse le vaisseau en volant,
  // sans collision. La touche G bascule vers la marche au sol (collision + gravité) pour qui veut.
  const ghost = useRef(true);

  // Casque d'appoint TOUJOURS ALLUMÉ : spot large et DOUX suivant la tête → on voit toujours
  // devant soi sans avoir à tenir T (l'intérieur étant sombre : coques peu réfléchissantes,
  // pas d'émissif exporté). T reste le faisceau FORT et focalisé par-dessus.
  const headlamp = useMemo(() => new THREE.SpotLight(0xfff4e0, 16, 45, Math.PI / 4.2, 0.7, 1.1), []);

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
      if (e.code === "KeyF") {
        zoom.current.held = true; // F maintenu : la molette zoome
        e.preventDefault();
        return;
      }
      if (e.code === "KeyG") {
        ghost.current = !ghost.current; // G : bascule vol libre ↔ marche au sol (collision)
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
  }, [standPos]);

  const tmp = useMemo(
    () => ({
      seg: new THREE.Line3(), box: new THREE.Box3(), mat: new THREE.Matrix4(),
      tp: new THREE.Vector3(), cp: new THREE.Vector3(),
      newStart: new THREE.Vector3(), delta: new THREE.Vector3(), oldStart: new THREE.Vector3(),
      fwd: new THREE.Vector3(), right: new THREE.Vector3(), wish: new THREE.Vector3(), dir: new THREE.Vector3(),
      headTgt: new THREE.Vector3(),
    }),
    [],
  );

  // État de la bulle de culling (mode chunké) : sphère réutilisée + dernière position de re-cull.
  const cull = useMemo(
    () => ({ sphere: new THREE.Sphere(new THREE.Vector3(), CHUNK_BUBBLE_R), last: new THREE.Vector3(Infinity, Infinity, Infinity) }),
    [],
  );

  useFrame((_, rawDt) => {
    const dt = Math.min(0.05, rawDt);
    const p = player.current;
    const inp = input.current;

    camera.getWorldDirection(tmp.dir);
    if (ghost.current) {
      // MODE VOL LIBRE (défaut) : 6 DOF calés sur la caméra. AVANT/ARRIÈRE = direction du regard
      // COMPLÈTE (inclut le tangage → viser le haut et avancer = monter, viser le bas = descendre) ;
      // GAUCHE/DROITE = droite caméra (reste horizontale) ; Espace/Maj = ascension/descente verticale
      // pure. Aucune collision, aucune gravité — on inspecte le vaisseau en volant à travers.
      tmp.fwd.copy(tmp.dir).normalize();
      tmp.right.crossVectors(tmp.fwd, camera.up);
      if (tmp.right.lengthSq() < 1e-6) tmp.right.set(1, 0, 0); // regard quasi vertical → droite indéfinie
      tmp.right.normalize();
      tmp.wish.set(0, 0, 0);
      tmp.wish.addScaledVector(tmp.fwd, (inp.f ? 1 : 0) - (inp.b ? 1 : 0));
      tmp.wish.addScaledVector(tmp.right, (inp.r ? 1 : 0) - (inp.l ? 1 : 0));
      tmp.wish.y += (inp.up ? 1 : 0) - (inp.down ? 1 : 0);
      if (tmp.wish.lengthSq() > 0) tmp.wish.normalize().multiplyScalar(SPEED);
      p.vel.copy(tmp.wish);
      p.pos.addScaledVector(p.vel, dt);
    } else {
      // MODE MARCHE (collision, bascule via G) : avant = projection HORIZONTALE (pieds au sol),
      // latéral = droite, gravité + Espace/Maj pour les échelles / le multi-pont.
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
      if (inp.up) p.vel.y = CLIMB;
      else if (inp.down) p.vel.y = -CLIMB;
      else p.vel.y += GRAVITY * dt;
      for (let i = 0; i < SUBSTEPS; i++) stepOnce(dt / SUBSTEPS);
    }

    camera.position.copy(p.pos);
    camera.position.y += EYE;

    // BULLE DE CULLING (mode chunké) : n'affiche que les chunks dans la sphère autour du joueur.
    // Re-cull SEULEMENT quand il a bougé (hystérésis) → sphère indépendante de la rotation = zéro
    // pop en tournant. La collision (collider baked, statique) n'est PAS affectée par la visibilité.
    if (chunks.length > 0 && camera.position.distanceToSquared(cull.last) > CHUNK_REPICK_DIST * CHUNK_REPICK_DIST) {
      cull.last.copy(camera.position);
      cull.sphere.center.copy(camera.position);
      for (let i = 0; i < chunks.length; i++) {
        chunks[i].node.visible = cull.sphere.intersectsBox(chunks[i].box);
      }
    }

    // Zoom lissé vers le fov cible (F + molette).
    const cam = camera as THREE.PerspectiveCamera;
    if (Math.abs(cam.fov - zoom.current.fov) > 0.05) {
      cam.fov = THREE.MathUtils.lerp(cam.fov, zoom.current.fov, Math.min(1, dt * 14));
      cam.updateProjectionMatrix();
    }

    // Casque d'appoint (toujours actif) : à la tête, pointe où l'on regarde.
    headlamp.position.copy(camera.position);
    camera.getWorldDirection(tmp.dir);
    tmp.headTgt.copy(camera.position).addScaledVector(tmp.dir, 10);
    headlamp.target.position.copy(tmp.headTgt);
    headlamp.target.updateMatrixWorld();
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
      <primitive object={headlamp} />
      <primitive object={headlamp.target} />
    </>
  );
}
