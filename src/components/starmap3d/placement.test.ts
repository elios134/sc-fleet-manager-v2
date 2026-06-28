import { describe, it, expect } from "vitest";
import { orbitRadius, placeOnPlane, bodyVisualRadius, SYS_R, R_MIN } from "./placement";

describe("orbitRadius", () => {
  it("borne basse à R_MIN quand d=0", () => {
    expect(orbitRadius(0, 10)).toBeCloseTo(R_MIN);
  });
  it("atteint SYS_R quand d=maxD", () => {
    expect(orbitRadius(10, 10)).toBeCloseTo(SYS_R);
  });
  it("croissante (compression sqrt)", () => {
    expect(orbitRadius(2, 10)).toBeLessThan(orbitRadius(8, 10));
  });
  it("maxD<=0 → R_MIN", () => {
    expect(orbitRadius(5, 0)).toBe(R_MIN);
  });
});

describe("placeOnPlane", () => {
  it("lon=0 → sur l'axe X, y≈0 z≈0", () => {
    const [x, y, z] = placeOnPlane(100, 0);
    expect(x).toBeCloseTo(100);
    expect(y).toBeCloseTo(0);
    expect(z).toBeCloseTo(0);
  });
  it("lon=90 → x≈0, plan tilté (y<0)", () => {
    const [x, y, z] = placeOnPlane(100, 90);
    expect(x).toBeCloseTo(0);
    expect(y).toBeLessThan(0); // -z·sin(TILT)
    expect(z).toBeGreaterThan(0);
  });
});

describe("bodyVisualRadius", () => {
  it("max quand size=maxSize", () => {
    expect(bodyVisualRadius(10, 10)).toBeCloseTo(4.2);
  });
  it("croissante", () => {
    expect(bodyVisualRadius(1, 10)).toBeLessThan(bodyVisualRadius(9, 10));
  });
});
