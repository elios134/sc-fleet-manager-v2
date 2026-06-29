import { describe, it, expect } from "vitest";
import {
  deriveStarRating,
  renderStars,
  formatLargeNumber,
  formatRewardRange,
  calculateUecPerHour,
  formatUecPerHourCompact,
} from "./missionStats";

describe("deriveStarRating", () => {
  it("paliers", () => {
    expect(deriveStarRating(null)).toBe(1);
    expect(deriveStarRating(0)).toBe(1);
    expect(deriveStarRating(5_000)).toBe(2);
    expect(deriveStarRating(30_000)).toBe(3);
    expect(deriveStarRating(80_000)).toBe(4);
    expect(deriveStarRating(200_000)).toBe(5);
  });
});

describe("renderStars", () => {
  it("clampe 1–5 et complète avec des cercles vides", () => {
    expect(renderStars(3)).toBe("●●●○○");
    expect(renderStars(0)).toBe("●○○○○");
    expect(renderStars(9)).toBe("●●●●●");
  });
});

describe("formatLargeNumber", () => {
  it("compacte", () => {
    expect(formatLargeNumber(1_500_000)).toBe("1.5M");
    expect(formatLargeNumber(2_000_000)).toBe("2M");
    expect(formatLargeNumber(12_000)).toBe("12K");
    expect(formatLargeNumber(500)).toBe("500");
  });
});

describe("formatRewardRange", () => {
  it("fourchette ou valeur unique", () => {
    expect(formatRewardRange({ rewardMin: 12_000, rewardMax: 30_000, timeMins: null })).toBe("12K–30K");
    expect(formatRewardRange({ rewardMin: 20_000, rewardMax: 20_000, timeMins: null })).toBe("20K");
    expect(formatRewardRange({ rewardMin: null, rewardMax: null, timeMins: null })).toBe("—");
  });
});

describe("calculateUecPerHour", () => {
  it("moyenne / durée en heures", () => {
    // avg 20000 sur 30 min → 40000/h
    expect(calculateUecPerHour({ rewardMin: 10_000, rewardMax: 30_000, timeMins: 30 })).toBe(40_000);
    expect(calculateUecPerHour({ rewardMin: 10_000, rewardMax: 30_000, timeMins: 0 })).toBeNull();
    expect(calculateUecPerHour({ rewardMin: null, rewardMax: 30_000, timeMins: 30 })).toBeNull();
  });
});

describe("formatUecPerHourCompact", () => {
  it("compact ou tiret", () => {
    expect(formatUecPerHourCompact(40_000)).toBe("40K/h");
    expect(formatUecPerHourCompact(null)).toBe("—");
  });
});
