import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { MeshBVH, computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from "three-mesh-bvh";

// Physique de la Visite : constantes, tri des maillages (portes, coque, parasites), collider
// BVH fusionné, recherche de plancher / point d'apparition. Patch BVH appliqué au chargement.
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export const RADIUS = 0.3;
export const HEIGHT = 1.75;
export const EYE = 1.62;
export const GRAVITY = -28;
export const SPEED = 4.5;
export const CLIMB = 3.5; // vitesse de montée/descente assistée (échelles / multi-pont)
export const SUBSTEPS = 5;
export const BASE_FOV = 75; // fov normal (doit matcher la caméra du Canvas)
export const MIN_FOV = 15; // zoom max (F + molette)
// Bulle de culling (pivot « moteur » : segmentation en chunks 10 m). On n'affiche que les chunks
// dans un rayon autour du joueur → coût CPU/frame borné même sur un capital de 16k meshes.
export const CHUNK_BUBBLE_R = 22; // m — rayon de la bulle (couvre le chunk courant + voisins)
export const CHUNK_REPICK_DIST = 2; // m — re-cull quand le joueur a bougé d'autant (hystérésis, économie CPU)

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
export function isSkippedTree(o: THREE.Object3D): boolean {
  for (let n: THREE.Object3D | null = o; n; n = n.parent) {
    if (n.name && isSkipped(n.name)) return true;
  }
  return false;
}

// Porte franchissable (sous-ensemble de isSkipped, hors primitives orphelines). En pipeline chunké,
// les portes sont RENDUES (repère résine) + collision skippée ; les orphelines restent masquées.
export function isDoorTree(o: THREE.Object3D): boolean {
  for (let n: THREE.Object3D | null = o; n; n = n.parent) {
    if (n.name && isPassable(n.name)) return true;
  }
  return false;
}

// Shell occulteur (silhouette extérieure fusionnée pour boucher les trous vus de l'intérieur),
// taggé `occluder_*` par asset-3d. Contrat : RENDU (backdrop derrière les trous) mais EXCLU de la
// collision (sinon il bloque le joueur). Distinct de isSkipped (qui, lui, masque ET retire).
export function isOccluderTree(o: THREE.Object3D): boolean {
  for (let n: THREE.Object3D | null = o; n; n = n.parent) {
    if (n.name && /occluder/i.test(n.name)) return true;
  }
  return false;
}

// Couches de COLLISION fournies par le pipeline (pivot « visite résine ») : `collision_walk`
// (plancher généré, étanche, par pont), `floor_patch` (rustines de sol) et `collision_hull`
// (enveloppe coque légère, cf. isHullTree). Contrat INVERSE du visuel : EXCLU du rendu (invisible)
// mais INCLUS dans le collider (le joueur marche dessus / les murs bloquent). Sert de filet sous le
// sol visuel troué → on ne tombe plus. Marqué `userData.colliderOnly` pour survivre au filtre !visible.
export function isCollisionTree(o: THREE.Object3D): boolean {
  for (let n: THREE.Object3D | null = o; n; n = n.parent) {
    if (n.name && /collision|floor_patch/i.test(n.name)) return true;
  }
  return false;
}

// Enveloppe de collision LÉGÈRE (contrat asset-3d `collision_hull`) : nœud+mesh `collision_hull`,
// render-off, positions seules (pas de normales — c'est un collider). ~117k tris sur un Carrack
// (vs ~619k pour les chunks visuels). Sa PRÉSENCE bascule le collider en « mode hull » : on
// construit le BVH depuis les SEULES couches collision (hull + walk + floor_patch) et on EXCLUT les
// `chunk_*` visuels (0.6–2.3 M tris) → BVH quasi-instant, supprime le hitch ~2 s à l'entrée Visite.
// Rétro-compat : un reader qui l'ignore le voit juste render-off et collisionne les chunks comme
// avant (zéro régression). Aussi utilisé pour EXCLURE le hull du walkBox de spawn (sa bbox = coque
// entière, murs compris → findOpenFloor échantillonnerait tout le vaisseau).
export function isHullTree(o: THREE.Object3D): boolean {
  for (let n: THREE.Object3D | null = o; n; n = n.parent) {
    if (n.name && /collision_hull/i.test(n.name)) return true;
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
export function cullOutsideHull(display: THREE.Object3D): number {
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

export function isMesh(o: THREE.Object3D): o is THREE.Mesh {
  return (o as THREE.Mesh).isMesh === true;
}

// Collider BVH monde à partir du modèle. Gère la quantification meshopt (positions Int16
// normalisées) : lecture dé-normalisée (fromBufferAttribute) puis matrice monde → mètres.
// Exclut les portes franchissables. `hullMode` (présence d'un `collision_hull`, cf. isHullTree) :
// le collider vient des SEULES couches collision (hull + walk + floor_patch), pas des chunks visuels
// → BVH quasi-instant. Le sol reste authoritatif via collision_walk/floor_patch ; le hull (sans
// lockBorder) peut avoir des micro-trous de murs mais la capsule joueur a un rayon (RADIUS) → pas de
// traversée gênante. Portes déjà retirées du hull (passages ouverts) → cohérent avec isSkippedTree.
export function buildCollider(scene: THREE.Object3D, hullMode: boolean): THREE.Mesh {
  scene.updateMatrixWorld(true);
  const geos: THREE.BufferGeometry[] = [];
  const v = new THREE.Vector3();
  scene.traverse((o) => {
    if (!isMesh(o) || !o.geometry?.attributes.position || isSkippedTree(o) || isOccluderTree(o)) return;
    // Mode hull : on ne garde QUE les couches collision (invisible, colliderOnly) → les chunks
    // visuels sont exclus du BVH. Sinon : !visible couvre portes masquées ET modules mal placés
    // cullés (cullOutsideHull) ; colliderOnly garde la couche collision malgré !visible.
    if (hullMode) {
      if (!isCollisionTree(o)) return;
    } else if (!o.visible && !o.userData.colliderOnly) {
      return;
    }
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
export const MIN_HEADROOM = 1.8;

// Cherche un plancher où l'on TIENT DEBOUT (vide vertical ≥ MIN_HEADROOM au-dessus → jamais
// encastré dans un mur/siège) dans une petite grille autour de (cx,cz). Biaise vers la proximité
// de (cx,cz) et, si fourni, d'une altitude cible `preferY` (le pont du siège pilote). null = rien.
export function findFloorNear(collider: THREE.Mesh, cx: number, cz: number, preferY?: number): THREE.Vector3 | null {
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
export const SPAWN_DIRS = Array.from({ length: 8 }, (_, a) =>
  new THREE.Vector3(Math.cos((a * Math.PI) / 4), 0, Math.sin((a * Math.PI) / 4)),
);
// Clairance horizontale en (x,y,z) : distance mini à la géométrie dans 8 directions. Sert à (1)
// noter les cases dégagées dans findOpenFloor, (2) valider qu'un spawn_point du pipeline n'est pas
// encastré dans un mur (bug capitaux : spawn_point parfois posé dans une cloison).
const _clearRc = new THREE.Raycaster();
const _clearOrigin = new THREE.Vector3();
export function horizontalClearance(collider: THREE.Mesh, x: number, y: number, z: number): number {
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
export function capsuleEmbedded(collider: THREE.Mesh, pos: THREE.Vector3): boolean {
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
export function floorAtLevel(collider: THREE.Mesh, x: number, z: number, nearY: number): number | null {
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
export function findClearSpawn(collider: THREE.Mesh, anchor: THREE.Vector3): THREE.Vector3 | null {
  for (const [dx, dz] of _spawnRings) {
    const fy = floorAtLevel(collider, anchor.x + dx, anchor.z + dz, anchor.y);
    if (fy == null) continue;
    const cand = new THREE.Vector3(anchor.x + dx, fy + 0.1, anchor.z + dz);
    if (!capsuleEmbedded(collider, cand)) return cand;
  }
  return null;
}
export function findOpenFloor(collider: THREE.Mesh, walkBox: THREE.Box3): THREE.Vector3 | null {
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
