import { describe, it, expect } from "vitest";
import { RSI_UNIT_KM, fuelPlan, legOf, moveStop, optimizeOrder, stopPoint, type ItineraryStop } from "./itinerary";
import type { GeoData, StarmapBodyItem } from "./starmapData";

const b = (id: string, name: string, navIcon: string, parent: string | null, system = "stanton"): StarmapBodyItem => ({
  id, recordName: id, systemName: system, navIcon, name, description: null, size: null, parentRef: parent,
  hideInStarmap: false, showOrbitLine: true, orbitOrder: null, source: "rsi", lastSyncedAt: null,
  posX: null, posY: null, posZ: null, wikiUuid: id, appearance: null, habitable: null, distance: null,
  longitude: null, latitude: null, subtype: null, affColor: null,
});
const g = (name: string, type: string, star: string, coord: [number, number, number]) => ({
  name, type, parentBody: null, parentStar: star, coord, bodyRadius: 100, rotationCorrection: 0, orbitRadius: 0, orbitAngle: 0,
  themeColor: [1, 1, 1] as [number, number, number],
});
const GEO: GeoData = {
  systems: [],
  bodies: [
    g("Crusader", "Planet", "Stanton", [-19_000_000, 0, 0]),
    g("ArcCorp", "Planet", "Stanton", [0, 0, 0]),
    g("HUR-L2", "Lagrange Point", "Stanton", [13_000_000, 0, 0]),
    g("Stanton-Pyro JP", "Jump Point", "Stanton", [0, 30_000_000, 0]),
    g("Pyro-Stanton JP", "Jump Point", "Pyro", [0, 0, 0]),
    g("Bloom", "Planet", "Pyro", [0, 10_000_000, 0]),
  ],
  pois: [{ name: "Area 18", type: "LandingZone", parentBody: "ArcCorp", coord: [500, 0, 0], wikiLink: null, quantum: true, hidden: false }],
};
const BODIES = [
  b("star", "Stanton", "Star", null),
  b("cru", "Crusader", "Planet", "star"),
  b("arc", "ArcCorp", "Planet", "star"),
  b("sera", "Seraphim Station", "Station", "cru"),
  b("l2", "HUR-L2 Faithful Dream Station", "Station", "star"),
  b("jp", "Stanton - Pyro", "Jumppoint", null),
  b("pstar", "Pyro", "Star", null, "pyro"),
  b("bloom", "Bloom", "Planet", "pstar", "pyro"),
  b("wik", "Wikelo Emporium Dasi Station", "Station", "star"),
  { ...b("gw", "Pyro Gateway", "Station", "star"), realX: 1000, realY: 2000, realZ: 0 },
  b("nyx1", "Nyx I", "Planet", null, "nyx"),
  // Nyx : aucune géométrie VerseTime → positions estimées depuis la carte RSI.
  b("nstar", "Nyx", "Star", null, "nyx"),
  { ...b("del", "Delamar", "Planet", "nstar", "nyx"), posX: -0.36, posY: -2.07, posZ: 0 },
  { ...b("lev", "Levski", "Station", "del", "nyx"), realX: -9_641_669, realY: 1, realZ: 0 },
  { ...b("njp", "Nyx - Pyro", "Jumppoint", null, "nyx"), posX: -0.56, posY: 2.64, posZ: 0 },
];
const stop = (bodyId: string, poi: string | null = null): ItineraryStop => ({ bodyId, poi });

describe("stopPoint", () => {
  it("corps connu de la géométrie, POI (corps + décalage local), station → son corps, Lagrange par préfixe", () => {
    expect(stopPoint(stop("cru"), BODIES, GEO)).toEqual({ system: "stanton", km: [-19_000_000, 0, 0] });
    expect(stopPoint(stop("arc", "Area 18"), BODIES, GEO)?.km).toEqual([500, 0, 0]);
    expect(stopPoint(stop("sera"), BODIES, GEO)?.km).toEqual([-19_000_000, 0, 0]);
    expect(stopPoint(stop("l2"), BODIES, GEO)?.km).toEqual([13_000_000, 0, 0]);
    expect(stopPoint(stop("jp"), BODIES, GEO)?.km).toEqual([0, 30_000_000, 0]);
  });
  it("station Wiki : coordonnées réelles (km) enregistrées à la synchro", () => {
    expect(stopPoint(stop("gw"), BODIES, GEO)).toEqual({ system: "stanton", km: [1000, 2000, 0] });
  });
  it("système sans géométrie (Nyx) : position estimée depuis la carte RSI, via le corps parent", () => {
    const lev = stopPoint(stop("lev"), BODIES, GEO);
    expect(lev?.estimated).toBe(true);
    expect(lev?.km?.[0]).toBeCloseTo(-0.36 * RSI_UNIT_KM);
    expect(lev?.km?.[1]).toBeCloseTo(-2.07 * RSI_UNIT_KM);
  });
  it("position inconnue : système connu, km null ; corps absent → null", () => {
    expect(stopPoint(stop("wik"), BODIES, GEO)).toEqual({ system: "stanton", km: null });
    expect(stopPoint(stop("nope"), BODIES, GEO)).toBeNull();
  });
});

describe("legOf", () => {
  const p = (id: string, poi: string | null = null) => stopPoint(stop(id, poi), BODIES, GEO);
  it("même système : distance directe en Gm", () => {
    expect(legOf(p("cru"), p("arc"), GEO, BODIES)).toMatchObject({ gm: 19, jump: null, parts: null });
  });
  it("autre système : via les deux points de saut, les deux moitiés séparées", () => {
    const l = legOf(p("arc"), p("bloom"), GEO, BODIES);
    expect(l.jump).toBe("Stanton – Pyro");
    expect(l.gm).toBeCloseTo(30 + 10);
    expect(l.parts?.[0]).toBeCloseTo(30);
    expect(l.parts?.[1]).toBeCloseTo(10);
  });
  it("vers Nyx : moitié d'arrivée estimée depuis le point de saut RSI, total inconnu si l'aller manque", () => {
    const l = legOf(p("bloom"), p("lev"), GEO, BODIES);
    expect(l.jump).toBe("Pyro – Nyx");
    expect(l.parts?.[0]).toBeNull();
    expect(l.parts?.[1]).toBeCloseTo(Math.hypot(-0.56 + 0.36, 2.64 + 2.07) * (RSI_UNIT_KM / 1e6));
    expect(l.gm).toBeNull();
    expect(l.estimated).toBe(true);
    const inside = legOf(p("lev"), p("njp"), GEO, BODIES);
    expect(inside.estimated).toBe(true);
    expect(inside.gm).toBeCloseTo(Math.hypot(-0.56 + 0.36, 2.64 + 2.07) * (RSI_UNIT_KM / 1e6));
  });
  it("étape sans position : distance inconnue, mais le saut reste compté", () => {
    expect(legOf(p("cru"), null, GEO, BODIES)).toMatchObject({ gm: null, jump: null });
    expect(legOf(p("cru"), p("wik"), GEO, BODIES)).toMatchObject({ gm: null, jump: null });
    expect(legOf(p("cru"), p("nyx1"), GEO, BODIES)).toMatchObject({ gm: null, jump: "Stanton – Nyx" });
  });
});

describe("fuelPlan", () => {
  const leg = (gm: number | null, parts: [number | null, number | null] | null = null) => ({ gm, parts });
  it("ok tant que la portée restante suffit, puis ravitaillement, puis trop loin", () => {
    expect(fuelPlan([leg(40), leg(20), leg(30), leg(80), leg(null)], 63).map((x) => x.leg)).toEqual(["ok", "ok", "refuel", "tooFar", null]);
  });
  it("saut entre systèmes : chaque moitié vérifiée, plein refait à la Gateway", () => {
    expect(fuelPlan([leg(40), leg(55, [25, 30]), leg(20)], 40)).toEqual([
      { leg: "ok", parts: null },
      { leg: "refuel", parts: ["refuel", "ok"] },
      { leg: "refuel", parts: null },
    ]);
    // Moitié trop longue même réservoir plein.
    expect(fuelPlan([leg(70, [20, 50])], 40)[0]).toEqual({ leg: "tooFar", parts: ["ok", "tooFar"] });
  });
  it("sans portée connue : rien", () => {
    expect(fuelPlan([leg(10)], null)).toEqual([{ leg: null, parts: null }]);
  });
});

describe("optimizeOrder", () => {
  it("garde le départ, puis va au plus proche à chaque fois ; inconnus à la fin", () => {
    const pos: Record<string, number> = { a: 0, far: 100, near: 10, mid: 50 };
    const d = (x: string, y: string) => (x in pos && y in pos ? Math.abs(pos[x] - pos[y]) : null);
    expect(optimizeOrder(["a", "far", "unk", "near", "mid"], d)).toEqual(["a", "near", "mid", "far", "unk"]);
  });
});

describe("moveStop", () => {
  it("monte / descend une étape, bornée aux extrémités", () => {
    expect(moveStop([1, 2, 3], 2, -1)).toEqual([1, 3, 2]);
    expect(moveStop([1, 2, 3], 0, -1)).toEqual([1, 2, 3]);
  });
});
