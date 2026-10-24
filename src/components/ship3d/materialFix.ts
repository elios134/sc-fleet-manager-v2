import * as THREE from "three";

/**
 * Certains matériaux CIG ont un `baseColorFactor` quasi-noir (#000) qui ANNULE l'albédo : three.js
 * calcule `texel × facteur`, donc un facteur nul rend la surface NOIRE quelle que soit la texture.
 * Symptôme observé : les vaisseaux Gama (Railen, Tyilui) ont ~35 % de leur coque en matériaux
 * `Paint_Base` / `Metal_Raw` / `Painted_Panel_Dark` à facteur #000 → coque noire uniforme (« bug
 * texture » signalé). Défense de rendu, indépendante d'un rebuild asset : si le facteur est ~noir,
 * on le remet à BLANC quand il y a une texture (albédo/émissif reprend la main) ou à un GRIS neutre
 * sinon. N'affecte que les matériaux réellement cassés (luminance linéaire < 0.03) ; les surfaces
 * sombres légitimement texturées (facteur gris foncé) passent au travers, ainsi que les TEINTES DE
 * LIVRÉE voulues (extras glTF → userData : `palette_tint` ou `tint_color` d'une couche), ex. la
 * peinture quasi noire du Cutlass Black.
 */
function authoredTint(data: Record<string, unknown> | undefined): boolean {
  if (!data) return false;
  const layers = data.layers;
  return data.palette_tint != null || (Array.isArray(layers) && layers.some((l) => !!(l as { tint_color?: unknown })?.tint_color));
}

export function deblackenMaterial(m: THREE.Material | null | undefined, fallbackGray = 0x6f7580): void {
  const sm = m as THREE.MeshStandardMaterial;
  if (!sm || !sm.color) return;
  const lum = 0.2126 * sm.color.r + 0.7152 * sm.color.g + 0.0722 * sm.color.b;
  if (lum >= 0.03 || authoredTint(sm.userData)) return;
  sm.color.setHex(sm.map || sm.emissiveMap ? 0xffffff : fallbackGray);
  sm.needsUpdate = true;
}

/** Filtrage anisotrope (×8 max) des textures d'un matériau : sols et parois vus de biais restent nets
 *  au lieu de baver (coût GPU négligeable, une fois par texture). */
export function sharpenTextures(m: THREE.Material | null | undefined, maxAnisotropy: number): void {
  const sm = m as THREE.MeshStandardMaterial;
  if (!sm) return;
  const level = Math.min(8, maxAnisotropy);
  for (const t of [sm.map, sm.normalMap, sm.roughnessMap, sm.metalnessMap, sm.emissiveMap, sm.aoMap]) {
    if (t && t.anisotropy !== level) {
      t.anisotropy = level;
      t.needsUpdate = true;
    }
  }
}

/** Vitrage à transmission (KHR_materials_transmission) → simple vitre transparente. La
 *  transmission oblige three.js à redessiner toute la scène opaque dans une texture à CHAQUE image
 *  (37 vitrages sur le Cutlass = 2,5 M triangles par image au lieu de 1,4 M) ; en Visite on la
 *  remplace par une transparence classique, visuellement très proche. */
export function simplifyGlass(m: THREE.Material | null | undefined): void {
  const pm = m as THREE.MeshPhysicalMaterial;
  if (!pm || !(pm.transmission > 0)) return;
  pm.transmission = 0;
  pm.transparent = true;
  pm.opacity = 0.25;
  pm.depthWrite = false;
  pm.needsUpdate = true;
}

// Matcap « argile / impression 3D résine » généré une fois (dégradé sphérique, lumière haut-gauche).
// Un MeshMatcapMaterial est NON éclairé : le relief vient du matcap, pas des lumières → jamais cramé
// même collé à une surface, lecture des formes constante. Idéal pour le mode « visite résine » (pivot)
// où seules la géométrie et la navigation comptent, pas les couleurs/textures.
let _clayMatcap: THREE.Texture | null = null;
// Teinte résine = bleu clair #639fdb (ton dominant sur les faces vers la caméra).
const CLAY_BASE: [number, number, number] = [0x63, 0x9f, 0xdb];
function clayMatcap(): THREE.Texture {
  if (_clayMatcap) return _clayMatcap;
  const clamp = (x: number) => Math.max(0, Math.min(255, x | 0));
  // interpole la base vers une cible (0 = noir, 255 = blanc) → reflet/ombre dérivés de la teinte.
  const mix = (t: number, target: number) => CLAY_BASE.map((c) => clamp(c + (target - c) * t));
  const rgb = (a: number[]) => `rgb(${a[0]},${a[1]},${a[2]})`;
  const s = 256;
  const cv = document.createElement("canvas");
  cv.width = cv.height = s;
  const ctx = cv.getContext("2d")!;
  // Fond = ombre profonde. Reflet DOUX (pas de spéculaire blanc pur → aspect MAT), transition large.
  ctx.fillStyle = rgb(mix(0.55, 0));
  ctx.fillRect(0, 0, s, s);
  const g = ctx.createRadialGradient(s * 0.38, s * 0.34, s * 0.04, s * 0.5, s * 0.5, s * 0.55);
  g.addColorStop(0, rgb(mix(0.55, 255))); // reflet doux
  g.addColorStop(0.45, rgb(CLAY_BASE)); // ton dominant (#22314f)
  g.addColorStop(0.8, rgb(mix(0.45, 0)));
  g.addColorStop(1, rgb(mix(0.62, 0)));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  _clayMatcap = tex;
  return tex;
}

// Matériau clay partagé pour le rendu « résine » (double-face : beaucoup de coques sont mono-face
// vues de l'intérieur). Une seule instance suffit (non éclairé, pas d'état par-mesh).
let _clayMaterial: THREE.MeshMatcapMaterial | null = null;
export function clayMaterial(): THREE.MeshMatcapMaterial {
  if (!_clayMaterial) {
    _clayMaterial = new THREE.MeshMatcapMaterial({ matcap: clayMatcap(), side: THREE.DoubleSide });
  }
  return _clayMaterial;
}
