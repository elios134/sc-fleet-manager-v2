import { describe, it, expect } from "vitest";
import type { TFunction } from "i18next";
import { aggregateLoadoutStats, deriveWeaponType, formatStat, getSignatureLevel, gradeRank } from "./helpers";
import type { SlotEdit } from "./types";

const t = ((k: string) => k) as unknown as TFunction;
const slot = (slotType: string, over: Partial<SlotEdit>) => ({ slotType, ...over }) as SlotEdit;

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

describe("libellés", () => {
  it("rang de grade, type d'arme dérivé de la classe, stat formatée", () => {
    expect([gradeRank("A"), gradeRank("D"), gradeRank(null)]).toEqual([4, 1, null]);
    expect(deriveWeaponType("KLWE_LaserRepeater_S3")).toBe("LASER REPEATER");
    expect(deriveWeaponType("AMRS_S2")).toBeNull();
    expect(deriveWeaponType(null)).toBeNull();
    expect(formatStat(1234.567, { precision: 1, unit: " m/s" } as never)).toBe("1234.6 m/s");
    expect(formatStat(null, {} as never)).toBe("—");
  });
  it("niveau de signature selon la section efficace", () => {
    expect(getSignatureLevel(null, t)).toBe("—");
    expect(getSignatureLevel(10_000, t)).toBe("loadout.sigMinimal");
    expect(getSignatureLevel(50_000, t)).toBe("loadout.sigLow");
    expect(getSignatureLevel(100_000, t)).toBe("loadout.sigMedium");
    expect(getSignatureLevel(500_000, t)).toBe("loadout.sigHigh");
  });
});
