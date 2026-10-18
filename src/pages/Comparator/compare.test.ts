import { describe, it, expect } from "vitest";
import { compareShips, type CmpRowDef, type ShipDataRow } from "./compare";

const ship = (o: Partial<ShipDataRow>): ShipDataRow => ({ ...({} as ShipDataRow), ...o });
const ROWS: CmpRowDef[] = [
  { key: "speed", group: "vol", labelKey: "s", get: (s) => s.maxSpeed, fmt: String },
  { key: "price", group: "logistique", labelKey: "p", get: (s) => s.priceUec, lowerIsBetter: true, fmt: String },
  { key: "hull", group: "combat", labelKey: "h", get: (s) => s.hullHp, fmt: String },
  { key: "cargo", group: "logistique", labelKey: "c", get: (s) => s.cargoScu, fmt: String },
];

describe("compareShips", () => {
  const a = ship({ maxSpeed: 1245, priceUec: 1.38e6, hullHp: null, cargoScu: 46 });
  const b = ship({ maxSpeed: 1080, priceUec: 1.79e6, hullHp: 14200, cargoScu: 46 });
  const r = compareShips(a, b, ROWS);
  const row = (k: string) => r.rows.find((x) => x.key === k)!;
  it("plus haut gagne", () => {
    expect(row("speed").winner).toBe("a");
    expect(row("speed").ratioB).toBeCloseTo(0.867, 2);
  });
  it("le plus bas gagne pour le prix", () => expect(row("price").winner).toBe("a"));
  it("valeur manquante : pas de gagnant, ligne non comparable", () => {
    expect(row("hull").winner).toBeNull();
    expect(row("hull").ratioA).toBe(0);
  });
  it("égalité : pas de gagnant mais comparable", () => expect(row("cargo").winner).toBeNull());
  it("score", () => {
    expect(r.comparable).toBe(3);
    expect(r.winsA).toBe(2);
    expect(r.winsB).toBe(0);
    expect(r.winsA + r.winsB).toBeLessThanOrEqual(r.comparable);
  });
});
