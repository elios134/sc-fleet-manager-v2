import { describe, it, expect } from "vitest";
import {
  formatCountdown,
  pyamProgressPercent,
  pyamSegmentStates,
  groupByLocation,
  PYAM_OPEN_SECONDS,
  PYAM_CLOSED_SECONDS,
} from "./hangarExec";

describe("formatCountdown", () => {
  it("mm:ss, minutes possiblement > 60", () => {
    expect(formatCountdown(0)).toBe("00:00");
    expect(formatCountdown(65)).toBe("01:05");
    expect(formatCountdown(120 * 60)).toBe("120:00");
    expect(formatCountdown(-5)).toBe("00:00");
  });
});

describe("pyamProgressPercent", () => {
  it("0 % au début de phase, 100 % à la fin", () => {
    expect(pyamProgressPercent(true, PYAM_OPEN_SECONDS)).toBe(0);
    expect(pyamProgressPercent(true, 0)).toBe(100);
    expect(pyamProgressPercent(false, PYAM_CLOSED_SECONDS)).toBe(0);
    expect(pyamProgressPercent(false, 0)).toBe(100);
  });
  it("~50 % à mi-phase", () => {
    expect(pyamProgressPercent(true, PYAM_OPEN_SECONDS / 2)).toBe(50);
  });
});

describe("pyamSegmentStates", () => {
  it("online : se remplit du début ; offline : se vide", () => {
    expect(pyamSegmentStates(true, 40)).toEqual([true, true, false, false, false]);
    expect(pyamSegmentStates(false, 40)).toEqual([false, false, false, true, true]);
  });
});

describe("groupByLocation", () => {
  it("regroupe et conserve l'ordre", () => {
    const g = groupByLocation([
      { location: "A", id: 1 },
      { location: "B", id: 2 },
      { location: "A", id: 3 },
    ]);
    expect([...g.keys()]).toEqual(["A", "B"]);
    expect(g.get("A")!.length).toBe(2);
  });
});
