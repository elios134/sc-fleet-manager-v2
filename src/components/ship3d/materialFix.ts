import * as THREE from "three";

/**
 * Certains matériaux CIG ont un `baseColorFactor` quasi-noir (#000) qui ANNULE l'albédo : three.js
 * calcule `texel × facteur`, donc un facteur nul rend la surface NOIRE quelle que soit la texture.
 * Symptôme observé : les vaisseaux Gama (Railen, Tyilui) ont ~35 % de leur coque en matériaux
 * `Paint_Base` / `Metal_Raw` / `Painted_Panel_Dark` à facteur #000 → coque noire uniforme (« bug
 * texture » signalé). Défense de rendu, indépendante d'un rebuild asset : si le facteur est ~noir,
 * on le remet à BLANC quand il y a une texture (albédo/émissif reprend la main) ou à un GRIS neutre
 * sinon. N'affecte que les matériaux réellement cassés (luminance linéaire < 0.03) ; les surfaces
 * sombres légitimement texturées (facteur gris foncé) passent au travers.
 */
export function deblackenMaterial(m: THREE.Material | null | undefined, fallbackGray = 0x6f7580): void {
  const sm = m as THREE.MeshStandardMaterial;
  if (!sm || !sm.color) return;
  const lum = 0.2126 * sm.color.r + 0.7152 * sm.color.g + 0.0722 * sm.color.b;
  if (lum >= 0.03) return;
  sm.color.setHex(sm.map || sm.emissiveMap ? 0xffffff : fallbackGray);
  sm.needsUpdate = true;
}

// Matcap « argile / impression 3D résine » généré une fois (dégradé sphérique, lumière haut-gauche).
// Un MeshMatcapMaterial est NON éclairé : le relief vient du matcap, pas des lumières → jamais cramé
// même collé à une surface, lecture des formes constante. Idéal pour le mode « visite résine » (pivot)
// où seules la géométrie et la navigation comptent, pas les couleurs/textures.
let _clayMatcap: THREE.Texture | null = null;
function clayMatcap(): THREE.Texture {
  if (_clayMatcap) return _clayMatcap;
  const s = 128;
  const cv = document.createElement("canvas");
  cv.width = cv.height = s;
  const ctx = cv.getContext("2d")!;
  // Teinte résine = gris-bleu #75929c (ton dominant, sur les faces vers la caméra), avec un reflet
  // plus clair (haut-gauche) et une ombre plus foncée (bords) pour garder le relief.
  ctx.fillStyle = "#2b373d";
  ctx.fillRect(0, 0, s, s);
  const g = ctx.createRadialGradient(s * 0.36, s * 0.32, s * 0.04, s * 0.5, s * 0.5, s * 0.52);
  g.addColorStop(0, "#c8d6db");
  g.addColorStop(0.42, "#75929c");
  g.addColorStop(0.78, "#52707a");
  g.addColorStop(1, "#33454c");
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
