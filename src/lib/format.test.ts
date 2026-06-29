import { describe, it, expect } from "vitest";
import { fmtAUEC, fmtNum } from "./format";

describe("fmtAUEC", () => {
  it("abrège par paliers", () => {
    expect(fmtAUEC(1_234_567)).toBe("1.23 M");
    expect(fmtAUEC(12_000)).toBe("12 k");
    expect(fmtAUEC(1_500)).toBe("1.5 k");
    expect(fmtAUEC(800)).toBe("800");
    expect(fmtAUEC(0)).toBe("0");
  });
});

describe("fmtNum", () => {
  it("arrondit et garde l'entier", () => {
    expect(fmtNum(3600.4)).toBe(fmtNum(3600));
    expect(fmtNum(0)).toBe("0");
  });
});
