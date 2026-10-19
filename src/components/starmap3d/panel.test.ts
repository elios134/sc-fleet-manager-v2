import { describe, it, expect } from "vitest";
import { bestRouteFrom, bodyTree, freshness, inventoryAt, jumpTarget, locationNames, poiLatLon, poiLegend, positionBody, systemFacts, systemSummaries } from "./panel";
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

describe("poiLatLon (même repère que le rendu : Y vers le haut)", () => {
  it("pôle, équateur, arrondi au degré ; vecteur nul → null", () => {
    expect(poiLatLon([0, 1000, 0])).toEqual({ lat: 90, lon: 0 });
    expect(poiLatLon([0, 0, 500])).toEqual({ lat: 0, lon: 90 });
    expect(poiLatLon([-1, 1, 0])).toEqual({ lat: 45, lon: 180 });
    expect(poiLatLon([0, 0, 0])).toBeNull();
  });
});

describe("défauts de la revue", () => {
  it("station sans parent (Checkmate, Pyro) listée au premier niveau et trouvable", () => {
    const list = [...BODIES, b("chk", "Checkmate", "Station", null, "pyro")];
    expect(bodyTree(list, "pyro", null, "").map((n) => `${n.depth}:${n.kind}:${n.body.name}`)).toContain("0:station:Checkmate");
    expect(bodyTree(list, "stanton", null, "check").map((n) => n.body.name)).toEqual(["Checkmate"]);
  });
  it("bestRouteFrom : mots entiers seulement (« Pyro I » ≠ « Pyro IV », « Ita » ≠ « Itanium »)", () => {
    const r = (from: string, profit: number) => ({ commodity: "X", fromLocation: from, toLocation: "B", profit }) as unknown as CargoRoute;
    expect(bestRouteFrom([r("Pyro IV Station", 10)], ["Pyro I"])).toBeNull();
    expect(bestRouteFrom([r("Itanium Depot", 10)], ["Ita"])).toBeNull();
    expect(bestRouteFrom([r("TDD Orison", 10)], ["Orison"])?.profit).toBe(10);
    expect(bestRouteFrom([r("Seraphim Station", 5)], ["Seraphim"])?.profit).toBe(5);
  });
});

describe("systemFacts", () => {
  it("compte planètes, lunes, stations, points de saut, ceintures ; description de l'étoile", () => {
    const withDesc = BODIES.map((x) => (x.id === "s" ? { ...x, description: "Système corporatif." } : x));
    expect(systemFacts(withDesc, "stanton")).toEqual({
      description: "Système corporatif.", planets: 2, moons: 3, stations: 1, jumps: 1, belts: 1,
    });
    expect(systemFacts(BODIES, "pyro")).toMatchObject({ description: null, planets: 1, jumps: 0 });
  });
});

describe("jumpTarget", () => {
  const systems = systemSummaries(BODIES);
  it("destination = l'autre système du nom « A - B », s'il est sur la carte", () => {
    const jp = BODIES.find((x) => x.id === "jp")!;
    expect(jumpTarget(jp, systems)).toEqual({ name: "Pyro", systemId: "pyro" });
  });
  it("système absent de la carte : nom seul, pas de lien", () => {
    expect(jumpTarget(b("jm", "Stanton - Magnus", "Jumppoint", "s"), systems)).toEqual({ name: "Magnus", systemId: null });
  });
  it("pas un point de saut, ou nom illisible → null", () => {
    expect(jumpTarget(BODIES[1], systems)).toBeNull();
    expect(jumpTarget(b("jx", "Jump Point", "Jumppoint", "s"), systems)).toBeNull();
  });
});

describe("poiLegend", () => {
  const poi = (name: string, type: string) => ({ name, type, parentBody: "Daymar", coord: [1, 1, 1] as [number, number, number], wikiLink: null, quantum: false, hidden: false });
  it("compte les lieux par type, du plus fréquent au moins fréquent", () => {
    const l = poiLegend([poi("a", "Outpost"), poi("b", "Cave"), poi("c", "Outpost"), poi("d", "Cave"), poi("e", "Outpost"), poi("f", "Wreck")]);
    expect(l.map((x) => `${x.kind}:${x.count}`)).toEqual(["outpost:3", "cave:2", "wreck:1"]);
  });
  it("aucun lieu → légende vide", () => {
    expect(poiLegend([])).toEqual([]);
  });
});

describe("positionBody", () => {
  it("station connue du journal → la station ; sinon la planète du lieu", () => {
    const withSeraphim = [...BODIES, b("sera", "Seraphim Station", "Station", "cru")];
    expect(positionBody("RR_CRU_LEO", withSeraphim)?.id).toBe("sera");
    expect(positionBody("RR_CRU_LEO", BODIES)?.id).toBe("cru");
    expect(positionBody("Stanton4_NewBabbage", BODIES)?.id).toBe("mic");
  });
  it("lieu absent ou inconnu → null", () => {
    expect(positionBody(null, BODIES)).toBeNull();
    expect(positionBody("Frontend_Main", BODIES)).toBeNull();
  });
});

describe("bodyTree — stations Wiki", () => {
  const withStations = [...BODIES, b("l4", "HUR-L4 Melodic Fields Station", "Station", "s"), b("grim", "Grim HEX", "Station", "day")];
  it("station de l'étoile au premier niveau", () => {
    expect(bodyTree(withStations, "stanton", null, "").some((n) => n.depth === 0 && n.body.id === "l4")).toBe(true);
  });
  it("station d'une lune listée sous la planète choisie", () => {
    const t = bodyTree(withStations, "stanton", "cru", "");
    expect(t.some((n) => n.depth === 1 && n.body.id === "grim")).toBe(true);
  });
});
