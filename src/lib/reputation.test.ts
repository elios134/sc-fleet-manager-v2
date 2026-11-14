import { describe, expect, it } from "vitest";
import { factionHue, factionKey, progressPct } from "./reputation";

describe("progressPct", () => {
  it("part du rang en cours déjà faite", () => {
    expect(progressPct({ inRank: 300, toNext: 22700 })).toBe(1);
    expect(progressPct({ inRank: 1800, toNext: 1800 })).toBe(50);
  });
  it("rang maximal : 100 %", () => expect(progressPct({ inRank: 10, toNext: null })).toBe(100));
  it("rien encore : 0 %", () => expect(progressPct({ inRank: 0, toNext: 800 })).toBe(0));
});

describe("factionKey / factionHue", () => {
  it("clé stable faction + échelle", () => expect(factionKey({ faction: "Covalex", scopeId: "Hauling" })).toBe("Covalex|Hauling"));
  it("teinte stable dans la palette", () => {
    expect(factionHue("InterSec Defense Solutions")).toBe(factionHue("InterSec Defense Solutions"));
    expect(factionHue("x")).toMatch(/^var\(--|^#/);
  });
});
