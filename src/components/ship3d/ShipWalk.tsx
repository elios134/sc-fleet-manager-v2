import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { PointerLockControls, useGLTF } from "@react-three/drei";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { MeshBVH, computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from "three-mesh-bvh";
import { MeshoptDecoder, type GLTFLoader } from "three-stdlib";
import type { TFunction } from "i18next";
import { deblackenMaterial, clayMaterial } from "./materialFix";
import { LightGrid, type ShipLightDef } from "../../lib/ship3dLights";

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
// Bulle de culling (pivot « moteur » : segmentation en chunks 10 m). On n'affiche que les chunks
// dans un rayon autour du joueur → coût CPU/frame borné même sur un capital de 16k meshes.
const CHUNK_BUBBLE_R = 22; // m — rayon de la bulle (couvre le chunk courant + voisins)
const CHUNK_REPICK_DIST = 2; // m — re-cull quand le joueur a bougé d'autant (hystérésis, économie CPU)

// Portes/vantaux/hatches franchissables en visite (fermés de base), hors murs/cadres structurels.
// ⚠ `bulkhead` SEUL est EXCLU du filtre : dans le pipeline clay, `..._int_bulkhead` = les MURS
// structurels (sections de coque de 9 m), PAS des portes → les skipper trouerait les murs (on
// passerait à travers). Les vraies portes contiennent toujours `door` ou `hatch` (`drak_door_bulkhead`,
// `Doors_Panel`, `Turret_Hatch`) donc rien n'est perdu.
const isPassable = (name: string) => /door|hatch/i.test(name) && !/wall|frame/i.test(name);
// Primitives orphelines (artefacts d'export : Box204…) → masquées + hors collision.
const isStray = (name: string) => /^(box|cube|plane|cylinder|sphere|cone|circle|icosphere|object|empty)[._]?\d+$/i.test(name);
// Meshes exclus du rendu et de la collision en visite.
const isSkipped = (name: string) => isPassable(name) || isStray(name);

// Un mesh est ignoré si LUI ou un de ses PARENTS est une porte franchissable / primitive orpheline.
// Indispensable : sur beaucoup de vaisseaux les portes sont des GROUPES dont les meshes enfants ont
// des noms vides ou génériques (Cutlass = portes mono-mesh donc OK par nom, mais Carrack/Constellation
// /Freelancer = groupes → les enfants échappaient à la règle et bloquaient/restaient visibles).
function isSkippedTree(o: THREE.Object3D): boolean {
  for (let n: THREE.Object3D | null = o; n; n = n.parent) {
    if (n.name && isSkipped(n.name)) return true;
  }
  return false;
}

// Porte franchissable (sous-ensemble de isSkipped, hors primitives orphelines). En pipeline chunké,
// les portes sont RENDUES (repère résine) + collision skippée ; les orphelines restent masquées.
function isDoorTree(o: THREE.Object3D): boolean {
  for (let n: THREE.Object3D | null = o; n; n = n.parent) {
    if (n.name && isPassable(n.name)) return true;
  }
  return false;
}

// Shell occulteur (silhouette extérieure fusionnée pour boucher les trous vus de l'intérieur),
// taggé `occluder_*` par asset-3d. Contrat : RENDU (backdrop derrière les trous) mais EXCLU de la
// collision (sinon il bloque le joueur). Distinct de isSkipped (qui, lui, masque ET retire).
function isOccluderTree(o: THREE.Object3D): boolean {
  for (let n: THREE.Object3D | null = o; n; n = n.parent) {
    if (n.name && /occluder/i.test(n.name)) return true;
  }
  return false;
}

// Couche de COLLISION fournie par le pipeline (pivot « visite résine ») : nœud `collision_*`
// (ex. `collision_walk` = plancher généré, étanche, par pont). Contrat INVERSE du visuel : EXCLU
// du rendu (invisible) mais INCLUS dans le collider (le joueur marche dessus). Sert de filet sous
// le sol visuel troué → on ne tombe plus. Le mesh visuel reste collisionné aussi (murs + escaliers
// que la couche plate n'a pas). Marqué `userData.colliderOnly` pour survivre au filtre !visible.
function isCollisionTree(o: THREE.Object3D): boolean {
  for (let n: THREE.Object3D | null = o; n; n = n.parent) {
    if (n.name && /collision/i.test(n.name)) return true;
  }
  return false;
}

// Cull des MODULES MAL PLACÉS (fleet-wide). Le shell occulteur (`occluder_shell`) a exactement les
// bounds de la vraie coque extérieure → sert de référence. Tout mesh dont la bbox monde DÉBORDE de
// la coque (au-delà d'une marge) est de la géométrie défectueuse (modules dupliqués/hors-coque, gros
// « bols » englobants texturés) → masqué (et donc hors collision via !visible dans buildCollider).
// Générique : fonctionne sur tout vaisseau ayant un occluder_shell. No-op si pas d'occluder.
// IMPORTANT : `precise=true` sur setFromObject/expandByObject. Sans lui, Box3 prend l'AABB de la
// bbox locale TOURNÉE (8 coins) → sous rotation + gros scale de déquantization meshopt, l'AABB
// GONFLE vers sa diagonale (ex. Idris mesh_318 : réel 88×8×124 m mais mesuré 89×89×124) → on
// culerait à tort des salles jointées légitimes = trous en jeu. precise=true = géométrie réelle,
// calcul une seule fois au chargement (pas par frame) donc coût acceptable.
function cullOutsideHull(display: THREE.Object3D): number {
  display.updateMatrixWorld(true);
  const hull = new THREE.Box3();
  display.traverse((o) => { if (isMesh(o) && isOccluderTree(o)) hull.expandByObject(o, true); });
  if (hull.isEmpty()) return 0;
  const lim = hull.clone().expandByScalar(2.0); // marge : tolère les débords légers (parois, collerettes)
  const mb = new THREE.Box3();
  const candidates: THREE.Mesh[] = [];
  let total = 0;
  display.traverse((o) => {
    if (!isMesh(o) || !o.visible || isOccluderTree(o)) return;
    total++;
    mb.setFromObject(o, true);
    if (mb.isEmpty()) return;
    if (
      mb.min.x < lim.min.x || mb.min.y < lim.min.y || mb.min.z < lim.min.z ||
      mb.max.x > lim.max.x || mb.max.y > lim.max.y || mb.max.z > lim.max.z
    ) {
      candidates.push(o);
    }
  });
  // Soupape : si le cull veut retirer >30 % des meshes, l'occluder est probablement anormal
  // (mauvais bounds) → on s'abstient pour ne pas vider l'intérieur par erreur.
  if (total > 0 && candidates.length > total * 0.3) return -candidates.length;
  candidates.forEach((o) => (o.visible = false));
  return candidates.length;
}

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
    // !visible couvre portes masquées ET modules mal placés cullés (voir cullOutsideHull).
    // colliderOnly : la couche collision (invisible) DOIT rester dans le collider malgré !visible.
    if (!isMesh(o) || (!o.visible && !o.userData.colliderOnly) || !o.geometry?.attributes.position || isSkippedTree(o) || isOccluderTree(o)) return;
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

// Spawn « pivot clay » : `hardpoint_seat_pilot` ayant disparu au nettoyage, on cherche le meilleur
// point de DÉPART sur l'emprise de `collision_walk`. On échantillonne une grille, on retient les
// cases avec un plancher DEBOUT (vide vertical ≥ MIN_HEADROOM), et on MAXIMISE la clairance
// horizontale (8 rayons à hauteur poitrine) → on apparaît au milieu d'une zone dégagée, jamais
// encastré dans une colonne/un mur (le centroïde géométrique, lui, tombe souvent sur une structure
// centrale). Coûteux mais calculé une seule fois au chargement.
const SPAWN_DIRS = Array.from({ length: 8 }, (_, a) =>
  new THREE.Vector3(Math.cos((a * Math.PI) / 4), 0, Math.sin((a * Math.PI) / 4)),
);
// Clairance horizontale en (x,y,z) : distance mini à la géométrie dans 8 directions. Sert à (1)
// noter les cases dégagées dans findOpenFloor, (2) valider qu'un spawn_point du pipeline n'est pas
// encastré dans un mur (bug capitaux : spawn_point parfois posé dans une cloison).
const _clearRc = new THREE.Raycaster();
const _clearOrigin = new THREE.Vector3();
function horizontalClearance(collider: THREE.Mesh, x: number, y: number, z: number): number {
  let c = Infinity;
  for (const d of SPAWN_DIRS) {
    _clearRc.set(_clearOrigin.set(x, y, z), d);
    _clearRc.far = 4;
    const h = _clearRc.intersectObject(collider, true);
    c = Math.min(c, h.length ? h[0].distance : 4);
  }
  return c;
}

// La capsule joueur à `pos` est-elle ENCASTRÉE dans la géométrie ? Test capsule vs BVH (identique à
// la résolution de collision) → détecte un mur/prop qui traverse la capsule, là où les rayons de
// clairance rataient (bug « spawn dans les murs » des capitaux). Le sol sous les pieds ne compte pas
// (le segment démarre à +RADIUS du sol → distance = RADIUS, pas de pénétration).
const _emSeg = new THREE.Line3();
const _emBox = new THREE.Box3();
const _emTp = new THREE.Vector3();
const _emCp = new THREE.Vector3();
function capsuleEmbedded(collider: THREE.Mesh, pos: THREE.Vector3): boolean {
  const bvh = collider.geometry.boundsTree;
  if (!bvh) return false;
  // collider baké en coords MONDE (matrice identité) → segment directement en monde.
  _emSeg.start.set(pos.x, pos.y + RADIUS, pos.z);
  _emSeg.end.set(pos.x, pos.y + HEIGHT - RADIUS, pos.z);
  _emBox.makeEmpty();
  _emBox.expandByPoint(_emSeg.start);
  _emBox.expandByPoint(_emSeg.end);
  _emBox.min.addScalar(-RADIUS);
  _emBox.max.addScalar(RADIUS);
  let maxDepth = 0;
  bvh.shapecast({
    intersectsBounds: (b) => b.intersectsBox(_emBox),
    intersectsTriangle: (tri) => {
      const dist = tri.closestPointToSegment(_emSeg, _emTp, _emCp);
      if (dist < RADIUS) {
        const d = RADIUS - dist;
        if (d > maxDepth) maxDepth = d;
      }
      return false;
    },
  });
  return maxDepth > 0.08; // pénétration > 8 cm = encastré dans un mur/prop
}

// Snap au sol au NIVEAU d'un point : rayon COURT `firstHitOnly` depuis juste au-dessus → pas cher
// même sur un capital dense (contrairement à un rayon multi-hits qui collecte des centaines de tris).
// null si aucun sol à portée sous le point.
const _snapRc = new THREE.Raycaster();
const _snapOrigin = new THREE.Vector3();
const _snapDown = new THREE.Vector3(0, -1, 0);
function floorAtLevel(collider: THREE.Mesh, x: number, z: number, nearY: number): number | null {
  _snapRc.firstHitOnly = true;
  _snapRc.set(_snapOrigin.set(x, nearY + 1.5, z), _snapDown);
  _snapRc.far = 5;
  const h = _snapRc.intersectObject(collider, true);
  return h.length ? h[0].point.y : null;
}
// Spawn DÉGAGÉ près d'une ancre (spawn_point / siège pilote) : on essaie l'ancre puis des anneaux
// croissants, on snappe au sol (firstHitOnly) et on retient le 1er point où la capsule N'EST PAS
// encastrée (capsuleEmbedded). Rapide (rayon court + 1 shapecast par candidat) → OK sur les capitaux
// où le grid multi-hits de findOpenFloor était trop lent. Reste proche de l'intention pipeline.
const _spawnRings: [number, number][] = [[0, 0]];
for (const r of [1.5, 3, 4.5, 6, 8]) for (const dir of SPAWN_DIRS) _spawnRings.push([dir.x * r, dir.z * r]);
function findClearSpawn(collider: THREE.Mesh, anchor: THREE.Vector3): THREE.Vector3 | null {
  for (const [dx, dz] of _spawnRings) {
    const fy = floorAtLevel(collider, anchor.x + dx, anchor.z + dz, anchor.y);
    if (fy == null) continue;
    const cand = new THREE.Vector3(anchor.x + dx, fy + 0.1, anchor.z + dz);
    if (!capsuleEmbedded(collider, cand)) return cand;
  }
  return null;
}
function findOpenFloor(collider: THREE.Mesh, walkBox: THREE.Box3): THREE.Vector3 | null {
  const bb = collider.geometry.boundingBox!;
  const far = bb.max.y - bb.min.y + 5;
  const down = new THREE.Raycaster();
  down.firstHitOnly = false;
  const origin = new THREE.Vector3();
  const downDir = new THREE.Vector3(0, -1, 0);
  let best: { x: number; y: number; z: number; cl: number } | null = null;
  for (let x = walkBox.min.x + 0.4; x <= walkBox.max.x - 0.4; x += 0.7) {
    for (let z = walkBox.min.z + 0.4; z <= walkBox.max.z - 0.4; z += 0.7) {
      down.set(origin.set(x, bb.max.y + 2, z), downDir);
      down.far = far;
      const ys = down.intersectObject(collider, true).map((h) => h.point.y).sort((a, b) => b - a);
      for (let i = 0; i < ys.length - 1; i++) {
        if (ys[i] - ys[i + 1] < MIN_HEADROOM) continue;
        const fY = ys[i + 1];
        const cl = horizontalClearance(collider, x, fY + 1.0, z);
        if (!best || cl > best.cl) best = { x, y: fY, z, cl };
        break;
      }
    }
  }
  return best ? new THREE.Vector3(best.x, best.y + 0.1, best.z) : null;
}

function WalkModel({
  url,
  keepMaterials = false,
  onGhostChange,
}: {
  url: string;
  keepMaterials?: boolean;
  onGhostChange?: (on: boolean) => void;
}) {
  const { scene: gltfScene } = useGLTF(url, false, false, (loader: GLTFLoader) =>
    loader.setMeshoptDecoder(MeshoptDecoder()),
  );
  const { camera } = useThree();

  const { display, collider, standPos, chunks } = useMemo(() => {
    const display = gltfScene;
    // Chunks du pipeline « moteur » (nœuds `chunk_<gx>_<gy>_<gz>`, grille 10 m). Leur présence
    // bascule le MODE CHUNKÉ : portes rendues, cull géométrique désactivé (asset-3d cull au build),
    // matrices statiques + bulle de culling par frame. Absent = ancien pipeline (comportement inchangé).
    const chunkRoots: THREE.Object3D[] = [];
    display.traverse((o) => { if (/^chunk_/i.test(o.name || "")) chunkRoots.push(o); });
    const hasChunks = chunkRoots.length > 0;
    // Emprise de la couche collision (spawn quand `hardpoint_seat_pilot` a été retiré au nettoyage :
    // on cherche la zone la plus dégagée de collision_walk, cf. findOpenFloor).
    const walkBox = new THREE.Box3();
    let walkCount = 0;
    display.traverse((o) => {
      if ((o as THREE.Light).isLight) { o.visible = false; return; }
      if (!isMesh(o)) return;
      if (isCollisionTree(o)) {
        // Couche collision : invisible + collision uniquement. On accumule son emprise pour le spawn.
        const cb = new THREE.Box3().setFromObject(o, true);
        if (!cb.isEmpty()) { walkBox.union(cb); walkCount++; }
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
            mats.forEach((m) => { m.side = THREE.DoubleSide; deblackenMaterial(m); });
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
        mats.forEach((m) => { m.side = THREE.DoubleSide; deblackenMaterial(m); });
      }
    });
    // Retire les modules mal placés (débordant de la coque = shell occulteur) AVANT de construire le
    // collider → ils ne bloquent plus et disparaissent du rendu. Fleet-wide, sans nommage.
    // SEULEMENT en non-chunké : le pipeline chunké cull déjà au build, et parcourir 16k meshes en
    // precise=true serait bien trop lent.
    if (!hasChunks) cullOutsideHull(display);
    const collider = buildCollider(display);
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

  const player = useRef({ pos: standPos.clone(), vel: new THREE.Vector3(), onGround: false });
  const segment = useMemo(
    () => new THREE.Line3(new THREE.Vector3(0, RADIUS, 0), new THREE.Vector3(0, HEIGHT - RADIUS, 0)),
    [],
  );
  const input = useRef({ f: false, b: false, l: false, r: false, up: false, down: false });
  // Zoom « jumelles » : F MAINTENU + molette → resserre le fov (lissé dans useFrame).
  // Relâcher F → retour au fov normal.
  const zoom = useRef({ held: false, fov: BASE_FOV });
  // Mode « fantôme » (touche G) : DÉPANNAGE tant que certaines portes intérieures ne sont pas
  // encore franchissables (rebuild asset-3d en cours) → désactive la collision, vol libre.
  const ghost = useRef(false);

  // Lampe torche « casque » (touche T) : spot suivant la tête, décalé à droite comme une
  // lampe de casque militaire, pointant où on regarde. Position/cible recalées chaque frame.
  const torch = useMemo(() => {
    const l = new THREE.SpotLight(0xfff2d9, 60, 30, Math.PI / 6.5, 0.45, 1.5);
    l.visible = false;
    return l;
  }, []);

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
      if (e.code === "KeyG") {
        ghost.current = !ghost.current; // G : mode fantôme (sans collision) on/off
        onGhostChange?.(ghost.current);
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
  }, [standPos, torch, onGhostChange]);

  const tmp = useMemo(
    () => ({
      seg: new THREE.Line3(), box: new THREE.Box3(), mat: new THREE.Matrix4(),
      tp: new THREE.Vector3(), cp: new THREE.Vector3(),
      newStart: new THREE.Vector3(), delta: new THREE.Vector3(), oldStart: new THREE.Vector3(),
      fwd: new THREE.Vector3(), right: new THREE.Vector3(), wish: new THREE.Vector3(), dir: new THREE.Vector3(),
      torchOff: new THREE.Vector3(), headTgt: new THREE.Vector3(),
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

    if (ghost.current) {
      // MODE FANTÔME : vol libre, aucune collision. Vertical = Espace/Shift, sinon on plane.
      p.vel.y = inp.up ? CLIMB : inp.down ? -CLIMB : 0;
      p.pos.addScaledVector(p.vel, dt);
    } else {
      // vertical : Espace = monter, Shift = descendre (échelles / multi-pont) ; sinon gravité.
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

    // Lampe torche : suit la tête (décalage « épaule droite » en repère caméra) et pointe
    // dans la direction du regard.
    if (torch.visible) {
      tmp.torchOff.set(0.22, -0.04, 0).applyQuaternion(camera.quaternion);
      torch.position.copy(camera.position).add(tmp.torchOff);
      camera.getWorldDirection(tmp.dir);
      torch.target.position.copy(torch.position).addScaledVector(tmp.dir, 12);
      torch.target.updateMatrixWorld();
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
      <primitive object={torch} />
      <primitive object={torch.target} />
      <primitive object={headlamp} />
      <primitive object={headlamp.target} />
    </>
  );
}

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

function ShipLights({ lights }: { lights: ShipLightDef[] }) {
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

// Environnement IBL neutre (procédural, offline-safe) → les surfaces PBR/métalliques de
// l'intérieur ne rendent plus NOIRES (sans envMap, le métal ne réfléchit rien). Intensité
// modérée : éclaire uniformément sans « bulle » brillante. Combiné à l'ACES du Canvas, ça
// remonte les basses lumières comme en vue extérieure — sans toucher aux émissifs.
function VisiteEnv() {
  const { scene, gl } = useThree();
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.5).texture;
    scene.environment = envTex;
    scene.environmentIntensity = 0.5;
    return () => {
      scene.environment = null;
      scene.environmentIntensity = 1;
      envTex.dispose();
      pmrem.dispose();
    };
  }, [scene, gl]);
  return null;
}

export default function ShipWalk({
  modelUrl,
  t,
  onExit,
  keepMaterials = false,
  lights = null,
}: {
  modelUrl: string;
  t: TFunction;
  onExit: () => void;
  keepMaterials?: boolean;
  /** Sidecar lumières du vaisseau (null = pas encore publié → éclairage générique seul). */
  lights?: ShipLightDef[] | null;
}) {
  const [ghost, setGhost] = useState(false);
  return (
    // Wrapper et Canvas TRANSPARENTS : le fond de la scène est le vrai fond de l'app
    // (glow teinté + étoiles animées de Layout), visible à travers les trous des
    // intérieurs (pas étanches) — même ambiance que le reste de l'app.
    <div className="absolute inset-0 z-20">
      <Canvas
        camera={{ fov: 75, near: 0.03, far: 3000, position: [0, 0, 6] }}
        gl={{ toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
      >
        {/* IBL doux (fill omnidirectionnel) + ACES (remonte les ombres) — cf. VisiteEnv.
            Les 3 lumières restent pour le relief ; le casque d'appoint garantit la vue devant. */}
        <VisiteEnv />
        <hemisphereLight args={["#e6e9ff", "#2a2a35", 1.1]} />
        <ambientLight intensity={0.35} />
        <directionalLight position={[2, 4, 2]} intensity={1.0} />
        <Suspense fallback={null}>
          <WalkModel url={modelUrl} keepMaterials={keepMaterials} onGhostChange={setGhost} />
        </Suspense>
        {lights && lights.length > 0 && <ShipLights lights={lights} />}
        <PointerLockControls onUnlock={onExit} />
      </Canvas>

      {ghost && (
        <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-[var(--accent)]/80 px-3 py-1 text-xs font-medium text-white backdrop-blur">
          {t("ship3d.ghostOn")}
        </div>
      )}

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
