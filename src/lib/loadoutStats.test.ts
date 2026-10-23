import { describe, it, expect } from "vitest";
import { aggregateLoadoutStats, type StatSlot } from "./loadoutStats";

const slot = (slotType: string, over: Partial<StatSlot>): StatSlot => ({ slotType, ...over });

describe("aggregateLoadoutStats", () => {
  it("additionne DPS, alpha, boucliers ; délai = pire cas ; marge d'énergie en %", () => {
    const s = aggregateLoadoutStats([
      slot("WEAPON", { realDps: 300, realAlphaDamage: 50, realPowerDraw: 10 }),
      slot("WEAPON", { realDps: 200, realPowerDraw: 10 }),
      slot("SHIELD", { realShieldHp: 4000, realShieldRegenRate: 120, realShieldDelayDmg: 2, realPowerDraw: 20 }),
      slot("SHIELD", { realShieldHp: 4000, realShieldRegenRate: 120, realShieldDelayDmg: 3.5 }),
      slot("POWER_PLANT", { realPowerOutput: 80 }),
    ]);
    expect(s).toMatchObject({
      totalDps: 500,
      totalAlphaDamage: 50,
      totalShieldHp: 8000,
      shieldRegenRate: 240,
      shieldDelayDmg: 3.5,
      totalPowerDraw: 40,
      totalPowerOutput: 80,
      powerMargin: 50,
    });
  });
  it("sans générateur : marge inconnue", () => {
    expect(aggregateLoadoutStats([slot("WEAPON", { realDps: 10 })]).powerMargin).toBeNull();
  });
});
