import { describe, it, expect } from "vitest";
import { bestRouteFrom, bodyTree, freshness, inventoryAt, locationNames, systemSummaries } from "./panel";
import type { StarmapBodyItem } from "./starmapData";
import type { CargoRoute } from "../../pages/CargoRoutes/types";
import type { ScopeTree } from "../../pages/Inventory/aggregate";

const b = (id: string, name: string, navIcon: string, parent: string | null, system = "stanton", distance: number | null = null): StarmapBodyItem => ({
  id, recordName: id, systemName: system, navIcon, name, description: null, size: null, parentRef: parent,
  hideInStarmap: false, showOrbitLine: true, orbitOrder: null, source: "rsi", lastSyncedAt: null,
  posX: null, posY: null, posZ: null, wikiUuid: id, appearance: null, habitable: null, distance,
  longitude: null, latitude: null, subtype: null, affColor: null,
});
const BODIES = [
  b("s", "Stanton", "Star", null),
  b("cru", "Crusader", "Planet", "s", "stanton", 1.28),
  b("mic", "microTech", "Planet", "s", "stanton", 2.9),
  b("cel", "Cellin", "Moon", "cru"),
  b("day", "Daymar", "Moon", "cru"),
  b("cal", "Calliope", "Moon", "mic"),
  b("olis", "Port Olisar", "Station", "cru"),
  b("halo", "Aaron Halo", "AsteroidBelt", "s"),
  b("jp", "Stanton - Pyro", "Jumppoint", "s"),
  b("py", "Pyro", "Star", null, "pyro"),
  b("py1", "Pyro I", "Planet", "py", "pyro", 1),
];

describe("systemSummaries", () => {
  it("compte planètes et lunes, système à étoile d'abord puis nom", () => {
    const s = systemSummaries(BODIES);
    expect(s.map((x) => x.id)).toEqual(["pyro", "stanton"]);
    expect(s.find((x) => x.id === "stanton")).toMatchObject({ planets: 2, moons: 3, name: "STANTON" });
  });
});

describe("bodyTree", () => {
  it("sans requête : enfants seulement sous le corps sélectionné, autres systèmes absents", () => {
    const t = bodyTree(BODIES, "stanton", "cru", "");
    expect(t.map((n) => `${n.depth}:${n.kind}:${n.body.name}`)).toEqual([
      "0:star:Stanton",
      "0:planet:Crusader",
      "1:station:Port Olisar",
      "1:moon:Cellin",
      "1:moon:Daymar",
      "0:planet:microTech",
      "0:belt:Aaron Halo",
      "0:jump:Stanton - Pyro",
    ]);
  });
  it("requête : tous systèmes, parent gardé pour situer l'enfant ; aucune correspondance → []", () => {
    const t = bodyTree(BODIES, "pyro", null, "dayM");
    expect(t.map((n) => `${n.depth}:${n.body.name}`)).toEqual(["0:Crusader", "1:Daymar"]);
    expect(bodyTree(BODIES, "stanton", null, "zzz")).toEqual([]);
  });
});

describe("locationNames", () => {
  it("corps + stations enfants (pas les lunes) ; lune seule", () => {
    expect(locationNames(BODIES[1], BODIES)).toEqual(["Crusader", "Port Olisar"]);
    expect(locationNames(BODIES[4], BODIES)).toEqual(["Daymar"]);
  });
});

describe("bestRouteFrom", () => {
  const r = (from: string, profit: number) => ({ commodity: "X", fromLocation: from, toLocation: "B", profit }) as unknown as CargoRoute;
  it("départ correspondant (insensible à la casse, partiel), plus gros profit ; aucun → null", () => {
    expect(bestRouteFrom([r("TDD Orison", 10), r("Seraphim Station", 50), r("Area18", 99)], ["orison", "Seraphim"])?.profit).toBe(50);
    expect(bestRouteFrom([r("Area18", 99)], ["Orison"])).toBeNull();
    expect(bestRouteFrom([], [])).toBeNull();
  });
});

describe("freshness", () => {
  const now = new Date("2026-10-18T12:00:00Z");
  const ago = (h: number) => now.getTime() / 1000 - h * 3600;
  it("heures si < 24 h, jours sinon, frais ≤ 48 h", () => {
    expect(freshness(ago(3), now)).toEqual({ label: "h", n: 3, fresh: true });
    expect(freshness(ago(72), now)).toEqual({ label: "d", n: 3, fresh: false });
    expect(freshness(null, now)).toBeNull();
  });
});

describe("inventoryAt", () => {
  const tree = { systems: [], planetsBySystem: {}, moiCount: 0, placesByPlanet: { microTech: [{ name: "Port Tressler", count: 9, type: "lieu", locId: "1" }] } } as ScopeTree;
  it("lieux rangés sous le corps ; arbre nul ou corps absent → []", () => {
    expect(inventoryAt(tree, "microTech")).toEqual([{ name: "Port Tressler", count: 9 }]);
    expect(inventoryAt(tree, "Hurston")).toEqual([]);
    expect(inventoryAt(null, "microTech")).toEqual([]);
  });
});
