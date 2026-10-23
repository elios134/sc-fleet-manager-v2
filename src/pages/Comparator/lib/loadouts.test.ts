import { describe, it, expect } from "vitest";
import { delta, equipmentDiff, loadoutStats, type EquipSlot } from "./loadouts";

const s = (slotType: string, componentName: string | null, over: Partial<EquipSlot> = {}): EquipSlot => ({
  slotType, componentName, componentClassName: componentName?.replace(/\s/g, "_") ?? null, ...over,
});

describe("loadoutStats", () => {
  it("stats du loadout + signature (section) du vaisseau", () => {
    const st = loadoutStats(
      [
        s("WEAPON", "M5A", { realDps: 300, realAlphaDamage: 60, realPowerDraw: 10 }),
        s("SHIELD", "FR-66", { realShieldHp: 6000, realShieldRegenRate: 120, realShieldDelayDmg: 4 }),
        s("POWER_PLANT", "JS-300", { realPowerOutput: 40 }),
      ],
      14200,
    );
    expect(st).toEqual({ dps: 300, alpha: 60, shieldHp: 6000, regen: 120, delay: 4, margin: 75, signature: 14200 });
  });
});

describe("delta", () => {
  it("écart en % par rapport à la référence, « mieux » selon le sens de la stat", () => {
    expect(delta(100, 120, true)).toEqual({ pct: 20, good: true });
    expect(delta(100, 80, true)).toEqual({ pct: -20, good: false });
    expect(delta(4, 3, false)).toEqual({ pct: -25, good: true });
  });
  it("écart négligeable (< 0,5 %) : ni mieux ni moins bien ; référence nulle ou absente : pas d'écart", () => {
    expect(delta(1000, 1004, true)).toEqual({ pct: 0.4, good: null });
    expect(delta(0, 50, true)).toEqual({ pct: null, good: null });
    expect(delta(null, 50, true)).toEqual({ pct: null, good: null });
    expect(delta(50, null, true)).toEqual({ pct: null, good: null });
  });
});

describe("equipmentDiff", () => {
  const stock = [s("WEAPON", "CF-337 Panther"), s("WEAPON", "CF-337 Panther"), s("WEAPON", null, { componentClassName: "Mount_Gimbal_S3" }), s("SHIELD", "FR-66"), s("COOLER", "Bracer")];
  const hunter = [s("WEAPON", "M5A"), s("WEAPON", "CF-337 Panther"), s("SHIELD", "FR-66"), s("COOLER", "Bracer")];
  it("un résumé par famille et par colonne ; montures ignorées ; familles absentes partout omises", () => {
    expect(equipmentDiff([stock, hunter])).toEqual([
      { group: "WEAPON", values: ["CF-337 Panther ×2", "CF-337 Panther, M5A"], differs: true },
      { group: "SHIELD", values: ["FR-66", "FR-66"], differs: false },
      { group: "COOLER", values: ["Bracer", "Bracer"], differs: false },
    ]);
  });
  it("famille vide dans une colonne → « — »", () => {
    expect(equipmentDiff([[s("MISSILE", "Arrester III")], []])).toEqual([{ group: "MISSILE", values: ["Arrester III", "—"], differs: true }]);
  });
});
