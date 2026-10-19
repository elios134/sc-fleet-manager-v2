import { describe, it, expect } from "vitest";
import { orbitRadius, placeOnPlane, bodyVisualRadius, coordToUnit, surfacePoint, lodLevelFor, sunDirection, SYS_R, R_MIN } from "./placement";

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

describe("coordToUnit", () => {
  it("normalise la coord en vecteur unité", () => {
    const [x, y, z] = coordToUnit([0, 10, 0], 0);
    expect(Math.hypot(x, y, z)).toBeCloseTo(1);
    expect(y).toBeCloseTo(1);
  });
  it("coord nulle → [0,1,0], jamais NaN", () => {
    const v = coordToUnit([0, 0, 0], 45);
    expect(v.every((c) => Number.isFinite(c))).toBe(true);
  });
});

describe("surfacePoint", () => {
  it("pose le POI à `globeRadius` du centre", () => {
    const p = surfacePoint([1, 0, 0], 0, 5);
    expect(Math.hypot(...p)).toBeCloseTo(5);
  });
});

describe("lodLevelFor", () => {
  it("loin→far, proche→body, très proche→surface", () => {
    expect(lodLevelFor(1000, 5)).toBe("far");
    expect(lodLevelFor(30, 5)).toBe("body");
    expect(lodLevelFor(8, 5)).toBe("surface");
  });
});

describe("sunDirection", () => {
  it("vecteur unitaire du corps vers l'étoile", () => {
    const d = sunDirection([30, 0, 40], [0, 0, 0]);
    expect(d[0]).toBeCloseTo(-0.6);
    expect(d[2]).toBeCloseTo(-0.8);
  });
  it("corps sur l'étoile ou étoile inconnue : lumière par défaut (dessus-avant)", () => {
    expect(sunDirection([0, 0, 0], [0, 0, 0])).toEqual([0.5, 0.5, 0.7071]);
    expect(sunDirection([1, 2, 3], null)).toEqual([0.5, 0.5, 0.7071]);
  });
});
