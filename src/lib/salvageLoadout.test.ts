import { describe, it, expect } from "vitest";
import { combineSalvage, freshSalvage, type SalvageHead } from "./salvageLoadout";

const head = (over: Partial<SalvageHead> = {}): SalvageHead => ({
  name: "H", company: "", size: 1, extractionSpeed: 100, radius: 2, efficiency: 0.9, price: 5000, buy: [],
  ...over,
});

describe("combineSalvage", () => {
  it("additionne la vitesse, prend le rayon max, moyenne l'efficacité, somme le prix", () => {
    const H = { A: head({ name: "A", extractionSpeed: 100, radius: 2, efficiency: 0.8, price: 5000 }), B: head({ name: "B", extractionSpeed: 150, radius: 3, efficiency: 1.0, price: 7000 }) };
    const s = combineSalvage(["A", "B"], H);
    expect(s.speed).toBe(250);
    expect(s.radius).toBe(3);
    expect(s.efficiency).toBeCloseTo(0.9);
    expect(s.price).toBe(12000);
  });
  it("bras vides → tout à zéro/null", () => {
    const s = combineSalvage(["", ""], {});
    expect(s.speed).toBe(0);
    expect(s.radius).toBeNull();
    expect(s.efficiency).toBeNull();
    expect(s.price).toBe(0);
  });
});

describe("freshSalvage", () => {
  it("Reclaimer a 2 bras vides", () => {
    expect(freshSalvage("Reclaimer")).toEqual(["", ""]);
  });
  it("Vulture a 1 bras", () => {
    expect(freshSalvage("Vulture").length).toBe(1);
  });
});
