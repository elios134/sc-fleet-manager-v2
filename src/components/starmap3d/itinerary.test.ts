import { describe, it, expect } from "vitest";
import { fuelLegs, legOf, moveStop, optimizeOrder, stopPoint, type ItineraryStop } from "./itinerary";
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
  it("position inconnue (station de l'étoile sans géométrie, corps absent) → null", () => {
    expect(stopPoint(stop("wik"), BODIES, GEO)).toBeNull();
    expect(stopPoint(stop("nope"), BODIES, GEO)).toBeNull();
  });
});

describe("legOf", () => {
  const p = (id: string, poi: string | null = null) => stopPoint(stop(id, poi), BODIES, GEO);
  it("même système : distance directe en Gm", () => {
    expect(legOf(p("cru"), p("arc"), GEO)).toEqual({ gm: 19, jump: null });
  });
  it("autre système : via les deux points de saut", () => {
    const l = legOf(p("arc"), p("bloom"), GEO);
    expect(l.jump).toBe("Stanton – Pyro");
    expect(l.gm).toBeCloseTo(30 + 10);
  });
  it("étape sans position : distance inconnue", () => {
    expect(legOf(p("cru"), null, GEO)).toEqual({ gm: null, jump: null });
  });
});

describe("fuelLegs", () => {
  it("ok tant que la portée restante suffit, puis ravitaillement, puis trop loin", () => {
    expect(fuelLegs([40, 20, 30, 80, null], 63)).toEqual(["ok", "ok", "refuel", "tooFar", null]);
  });
  it("sans portée connue : rien", () => {
    expect(fuelLegs([10], null)).toEqual([null]);
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
