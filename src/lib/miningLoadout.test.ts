import { describe, it, expect } from "vitest";
import { multStack, turretPower, calc, totalPrice, freshLoadout, type Laser, type MiningModule } from "./miningLoadout";

const laser = (over: Partial<Laser> = {}): Laser => ({
  name: "L", company: "", size: 1, minPower: 900, maxPower: 3600, extPower: 100, optRange: 30, maxRange: 90,
  resistance: -10, instability: null, inert: null, chargeWindow: null, chargeRate: null, moduleSlots: 2, price: 1000, buy: [],
  ...over,
});
const mod = (over: Partial<MiningModule> = {}): MiningModule => ({
  name: "M", type: "Passive", powerPct: null, extPowerPct: null, resistance: null, instability: null, inert: null,
  chargeRate: null, chargeWindow: null, overcharge: null, shatter: null, uses: 0, duration: null, price: 500, buy: [],
  ...over,
});

describe("multStack", () => {
  it("stacking multiplicatif", () => {
    expect(multStack([10, 10])).toBeCloseTo(21); // 1.1*1.1-1 = 0.21
  });
  it("vide → 0", () => {
    expect(multStack([])).toBe(0);
  });
});

describe("turretPower", () => {
  it("laser seul → maxPower", () => {
    const L = { L: laser() };
    expect(turretPower({ laser: "L", modules: [] }, L, {})).toBe(3600);
  });
  it("module 85% → -15%", () => {
    const L = { L: laser() };
    const M = { P: mod({ name: "P", powerPct: 85 }) };
    expect(turretPower({ laser: "L", modules: ["P"] }, L, M)).toBeCloseTo(3060); // 3600*0.85
  });
});

describe("calc + totalPrice", () => {
  it("agrège puissance et exclut le laser de base du prix", () => {
    const L = { Arbor: laser({ name: "Arbor", price: 0 }), Lancet: laser({ name: "Lancet", maxPower: 4000, price: 89000 }) };
    const M = { Focus: mod({ name: "Focus", powerPct: 90, price: 3800 }) };
    const loadout = [{ laser: "Lancet", modules: ["Focus"] }];
    const s = calc(loadout, "", L, M, {});
    expect(s.maxP).toBeCloseTo(3600); // 4000*0.9
    // prix : Lancet (89000) + Focus (3800), stock 'Arbor' exclu
    expect(totalPrice(loadout, "", "Arbor", L, M, {})).toBe(92800);
  });
});

describe("freshLoadout", () => {
  it("pré-remplit avec le laser de base et le bon nombre de slots", () => {
    const fl = freshLoadout("Prospector");
    expect(fl.loadout.length).toBe(1);
    expect(fl.loadout[0].laser).toBe("Arbor MH1 Mining Laser");
    expect(fl.loadout[0].modules.length).toBe(2);
    expect(fl.gadget).toBe("");
  });
});
