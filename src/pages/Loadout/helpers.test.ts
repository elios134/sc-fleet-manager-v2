import { describe, it, expect } from "vitest";
import type { TFunction } from "i18next";
import { deriveWeaponType, formatStat, getSignatureLevel, gradeRank } from "./helpers";
import type { SlotEdit } from "./types";

const t = ((k: string) => k) as unknown as TFunction;
const slot = (slotType: string, over: Partial<SlotEdit>) => ({ slotType, ...over }) as SlotEdit;

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
