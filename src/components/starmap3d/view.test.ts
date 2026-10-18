import { describe, it, expect } from "vitest";
import { crumbsOf, focusFor, reduceView, selectionFlight, type ViewState } from "./view";
import type { StarmapBodyItem } from "./starmapData";

const b = (id: string, name: string, navIcon: string, system = "stanton"): StarmapBodyItem => ({
  id, recordName: id, systemName: system, navIcon, name, description: null, size: null, parentRef: null,
  hideInStarmap: false, showOrbitLine: true, orbitOrder: null, source: "rsi", lastSyncedAt: null,
  posX: null, posY: null, posZ: null, wikiUuid: id, appearance: null, habitable: null, distance: null,
  longitude: null, latitude: null, subtype: null, affColor: null,
});
const DAY = b("day", "Daymar", "Moon");
const OLIS = b("olis", "Port Olisar", "Station");
const PY1 = b("py1", "Pyro I", "Planet", "pyro");
const BODIES = [DAY, OLIS, PY1];
const SYS: ViewState = { view: { level: "system", systemId: "stanton" }, selectedId: null, poi: null };

describe("reduceView", () => {
  it("select d'un corps d'un autre système → vue système de ce système", () => {
    expect(reduceView(SYS, { type: "select", body: PY1 })).toEqual({ view: { level: "system", systemId: "pyro" }, selectedId: "py1", poi: null });
  });
  it("select depuis la galaxie → vue système du corps", () => {
    expect(reduceView({ view: { level: "galaxy" }, selectedId: null, poi: null }, { type: "select", body: DAY }).view).toEqual({ level: "system", systemId: "stanton" });
  });
  it("approach → vue globe ; 2e select du corps sélectionné (planète/lune) = approach ; pas pour une station", () => {
    const globe = { view: { level: "object", systemId: "stanton", bodyId: "day" }, selectedId: "day", poi: null };
    expect(reduceView(SYS, { type: "approach", body: DAY })).toEqual(globe);
    expect(reduceView({ ...SYS, selectedId: "day" }, { type: "select", body: DAY })).toEqual(globe);
    expect(reduceView({ ...SYS, selectedId: "olis" }, { type: "select", body: OLIS }).view.level).toBe("system");
  });
  it("poi : ignoré hors vue globe, posé en vue globe", () => {
    expect(reduceView(SYS, { type: "poi", name: "Shubin" })).toBe(SYS);
    const globe: ViewState = { view: { level: "object", systemId: "stanton", bodyId: "day" }, selectedId: "day", poi: null };
    expect(reduceView(globe, { type: "poi", name: "Shubin" }).poi).toBe("Shubin");
  });
  it("fil d'Ariane depuis un POI : corps, puis système, puis galaxie", () => {
    const atPoi: ViewState = { view: { level: "object", systemId: "stanton", bodyId: "day" }, selectedId: "day", poi: "Shubin" };
    expect(reduceView(atPoi, { type: "crumb", level: "object" })).toEqual({ ...atPoi, poi: null });
    expect(reduceView(atPoi, { type: "crumb", level: "system" })).toEqual({ view: { level: "system", systemId: "stanton" }, selectedId: "day", poi: null });
    expect(reduceView(atPoi, { type: "crumb", level: "galaxy" })).toEqual({ view: { level: "galaxy" }, selectedId: null, poi: null });
  });
  it("system et clear effacent sélection et POI", () => {
    const st: ViewState = { view: { level: "object", systemId: "stanton", bodyId: "day" }, selectedId: "day", poi: "x" };
    expect(reduceView(st, { type: "system", systemId: "pyro" })).toEqual({ view: { level: "system", systemId: "pyro" }, selectedId: null, poi: null });
    expect(reduceView(SYS, { type: "clear" })).toEqual(SYS);
    expect(reduceView({ ...SYS, selectedId: "day" }, { type: "clear" }).selectedId).toBeNull();
  });
});

describe("crumbsOf", () => {
  it("GALAXIE › STANTON › DAYMAR › POI", () => {
    const st: ViewState = { view: { level: "object", systemId: "stanton", bodyId: "day" }, selectedId: "day", poi: "Shubin SAL-2" };
    expect(crumbsOf(st, BODIES)).toEqual([
      { label: "GALAXIE", level: "galaxy" },
      { label: "STANTON", level: "system" },
      { label: "DAYMAR", level: "object" },
      { label: "Shubin SAL-2", level: "poi" },
    ]);
    expect(crumbsOf({ view: { level: "galaxy" }, selectedId: null, poi: null }, BODIES)).toEqual([{ label: "GALAXIE", level: "galaxy" }]);
  });
});

describe("select en vue globe d'un corps qui n'est ni le corps ni son enfant", () => {
  it("bascule en vue système (sinon carte bloquée sur l'ancien globe)", () => {
    const HUR = b("hur", "Hurston", "Planet");
    const globe: ViewState = { view: { level: "object", systemId: "stanton", bodyId: "cru" }, selectedId: "cru", poi: null };
    expect(reduceView(globe, { type: "select", body: HUR, childOfFocus: false }).view).toEqual({ level: "system", systemId: "stanton" });
    expect(reduceView(globe, { type: "select", body: DAY, childOfFocus: true }).view).toEqual(globe.view);
  });
});

describe("focusFor : un vol caméra n'est rejoué que dans la scène qui l'a demandé", () => {
  it("clé de scène différente → null", () => {
    const f = { pos: [0, 0, 0] as [number, number, number], dist: 8, nonce: 3, key: "obj:cru" };
    expect(focusFor(f, "obj:cru")).toBe(f);
    expect(focusFor(f, "sys:stanton")).toBeNull();
    expect(focusFor(null, "sys:stanton")).toBeNull();
  });
});

describe("selectionFlight : vol à la sélection (scène ou rail)", () => {
  it("vue système → vol ; vue globe : corps focalisé → aucun vol, enfant → vol ; rien → null", () => {
    expect(selectionFlight("system", "cru", null)).toBe(7);
    expect(selectionFlight("object", "cru", "cru")).toBeNull();
    expect(selectionFlight("object", "day", "cru")).toBe(7);
    expect(selectionFlight("system", null, null)).toBeNull();
  });
});
