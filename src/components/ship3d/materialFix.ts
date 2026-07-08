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
