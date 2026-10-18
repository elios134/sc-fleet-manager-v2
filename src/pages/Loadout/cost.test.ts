import { describe, it, expect } from "vitest";
import { provenanceOf, loadoutCost, powerPips, type Provenance } from "./cost";
import type { AcqDetailData, SlotEdit } from "./types";

const slot = (cls: string | null): SlotEdit => ({
  portName: "p", displayName: "p", slotType: "WEAPON", slotSize: 3, componentClassName: cls,
  componentName: cls, componentGrade: "A", componentMake: null,
});
const acq = (buy: { terminal: string | null; price: number | null }[], craft = false): AcqDetailData => ({
  buy, craft: craft ? { blueprintId: "bp", timeSeconds: null, ingredients: [] } : null, ships: [],
});

describe("provenanceOf", () => {
  it("même classe que le stock → d'origine", () => {
    expect(provenanceOf(slot("gun_a"), "gun_a", acq([]))).toEqual({ kind: "stock" });
  });
  it("achat le moins cher avec prix connu", () => {
    const a = acq([{ terminal: "A", price: 900 }, { terminal: "B", price: 700 }, { terminal: "C", price: null }]);
    expect(provenanceOf(slot("gun_b"), "gun_a", a)).toEqual({ kind: "buy", terminal: "B", price: 700 });
  });
  it("pas d'achat mais craftable → craft", () => {
    expect(provenanceOf(slot("gun_b"), "gun_a", acq([], true))).toEqual({ kind: "craft" });
  });
  it("rien → inconnu", () => {
    expect(provenanceOf(slot("gun_b"), "gun_a", null)).toEqual({ kind: "unknown" });
  });
});

describe("loadoutCost", () => {
  it("regroupe par magasin et totalise", () => {
    const items: Provenance[] = [
      { kind: "stock" },
      { kind: "buy", terminal: "A", price: 100 },
      { kind: "buy", terminal: "A", price: 50 },
      { kind: "buy", terminal: "B", price: 70 },
      { kind: "craft" },
    ];
    expect(loadoutCost(items)).toEqual({
      owned: 1, craft: 1, unknown: 0,
      byTerminal: [{ terminal: "A", total: 150 }, { terminal: "B", total: 70 }],
      total: 220,
    });
  });
});

describe("powerPips", () => {
  it("part de la production consommée", () => {
    expect(powerPips(11, 14, 10)).toEqual({ on: 8, over: false });
    expect(powerPips(16, 14, 10)).toEqual({ on: 10, over: true });
    expect(powerPips(5, 0, 10)).toEqual({ on: 0, over: false });
  });
});
