import { describe, it, expect } from "vitest";
import { provenanceOf, loadoutCost, powerPips, routeKey, fmtMinutes, initialShip, type Provenance } from "./cost";
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

describe("tournée d'achat", () => {
  it("clé indépendante de l'ordre, change si le loadout change", () => {
    expect(routeKey(["b", "a"])).toBe(routeKey(["a", "b"]));
    expect(routeKey(["a"])).not.toBe(routeKey(["a", "c"]));
  });
  it("minutes arrondies, inconnue → ?", () => {
    expect(fmtMinutes(12.6666)).toBe("13");
    expect(fmtMinutes(null)).toBe("?");
  });
});

describe("initialShip (?ship=, présélection, flotte)", () => {
  const fleet = [{ id: 10, shipDataId: 100 }, { id: 11, shipDataId: 101 }];
  it("?ship= possédé → vaisseau de flotte, sinon catalogue (même sans flotte)", () => {
    expect(initialShip(fleet, 101, null)).toEqual({ kind: "owned", id: 11 });
    expect(initialShip(fleet, 555, null)).toEqual({ kind: "catalog", shipDataId: 555 });
    expect(initialShip([], 555, null)).toEqual({ kind: "catalog", shipDataId: 555 });
  });
  it("sans ?ship= : présélection valide, sinon 1er de la flotte, sinon rien", () => {
    expect(initialShip(fleet, null, 11)).toEqual({ kind: "owned", id: 11 });
    expect(initialShip(fleet, null, 99)).toEqual({ kind: "owned", id: 10 });
    expect(initialShip([], null, null)).toBeNull();
  });
});
