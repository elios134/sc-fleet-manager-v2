import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { deblackenMaterial, simplifyGlass } from "./materialFix";

const mat = (hex: number, userData: Record<string, unknown> = {}, withMap = true) => {
  const m = new THREE.MeshStandardMaterial({ color: hex, map: withMap ? new THREE.Texture() : null });
  m.userData = userData;
  return m;
};

describe("deblackenMaterial", () => {
  it("facteur noir cassé (Gama, sans teinte de livrée) → blanc avec texture, gris sans", () => {
    const a = mat(0x000000);
    deblackenMaterial(a);
    expect(a.color.getHex()).toBe(0xffffff);
    const b = mat(0x000000, {}, false);
    deblackenMaterial(b);
    expect(b.color.getHex()).toBe(0x6f7580);
  });
  it("teinte de livrée voulue (peinture noire du Cutlass Black) → intacte", () => {
    const viaPalette = mat(0x030303, { palette_tint: 1 });
    deblackenMaterial(viaPalette);
    expect(viaPalette.color.getHex()).toBe(0x030303);
    const viaLayer = mat(0x030303, { layers: [{ path: "x.mtl", tint_color: [0.013, 0.013, 0.013] }] });
    deblackenMaterial(viaLayer);
    expect(viaLayer.color.getHex()).toBe(0x030303);
  });
  it("surface sombre mais pas noire → intacte", () => {
    const m = mat(0x404040);
    deblackenMaterial(m);
    expect(m.color.getHex()).toBe(0x404040);
  });
});

describe("simplifyGlass", () => {
  it("vitrage à transmission → vitre transparente simple (évite une 2e passe de rendu par image)", () => {
    const g = new THREE.MeshPhysicalMaterial({ transmission: 0.96 });
    simplifyGlass(g);
    expect(g.transmission).toBe(0);
    expect(g.transparent).toBe(true);
    expect(g.opacity).toBeCloseTo(0.25);
    expect(g.depthWrite).toBe(false);
  });
  it("matériau opaque → intact", () => {
    const m = new THREE.MeshStandardMaterial();
    simplifyGlass(m);
    expect(m.transparent).toBe(false);
  });
});

