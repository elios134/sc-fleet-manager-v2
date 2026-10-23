import { describe, it, expect } from "vitest";
import type { StarmapBodyItem } from "../../../components/starmap3d/starmapData";
import { bestOffer, cartItinerary, cartSummary, offerStop, sortComponents, type CartLine, type Offer, type PlacedOffer } from "./shopping";

const b = (id: string, name: string, navIcon: string, parent: string | null, system = "stanton"): StarmapBodyItem => ({
  id, recordName: id, systemName: system, navIcon, name, description: null, size: null, parentRef: parent,
  hideInStarmap: false, showOrbitLine: true, orbitOrder: null, source: "rsi", lastSyncedAt: null,
  posX: null, posY: null, posZ: null, wikiUuid: id, appearance: null, habitable: null, distance: null,
  longitude: null, latitude: null, subtype: null, affColor: null,
});
const BODIES = [
  b("star", "Stanton", "Star", null),
  b("arc", "ArcCorp", "Planet", "star"),
  b("mic", "microTech", "Planet", "star"),
  b("cru", "Crusader", "Planet", "star"),
  b("sera", "Seraphim Station", "Station", "cru"),
  b("pyro5", "Pyro V", "Planet", "pstar", "pyro"),
  b("ignis", "Ignis", "Moon", "pyro5", "pyro"),
  b("lev", "Levski", "Station", "del", "nyx"),
];
const offer = (o: Partial<Offer>): Offer => ({
  className: "c", terminal: "T", price: 1000, system: "Stanton", planet: null, moon: null, station: null, city: null, outpost: null, ...o,
});
const placed = (terminal: string, price: number, gm: number | null): PlacedOffer => ({ ...offer({ terminal, price }), stop: null, gm });

describe("offerStop", () => {
  it("station → corps Station, ville → POI de la planète, avant-poste → POI de la lune", () => {
    expect(offerStop(offer({ planet: "Crusader", station: "Seraphim Station" }), BODIES)).toEqual({ bodyId: "sera", poi: null });
    expect(offerStop(offer({ planet: "MicroTech", city: "New Babbage" }), BODIES)).toEqual({ bodyId: "mic", poi: "New Babbage" });
    expect(offerStop(offer({ system: "Pyro", planet: "Pyro V", moon: "Ignis", outpost: "Ashland" }), BODIES)).toEqual({ bodyId: "ignis", poi: "Ashland" });
  });
  it("ville sans planète (Levski) → station du même nom", () => {
    expect(offerStop(offer({ system: "Nyx", city: "Levski" }), BODIES)).toEqual({ bodyId: "lev", poi: null });
  });
  it("lieu inconnu de la carte → null", () => {
    expect(offerStop(offer({ planet: "Hurston", city: "Lorville" }), BODIES)).toBeNull();
  });
});

describe("bestOffer", () => {
  const offers = [placed("Loin pas cher", 900, 30), placed("Proche", 1200, 2), placed("Hors carte", 800, null)];
  it("plus proche : distance la plus courte (prix en départage)", () => {
    expect(bestOffer(offers, "nearest")?.terminal).toBe("Proche");
  });
  it("moins cher et meilleur : prix le plus bas", () => {
    expect(bestOffer(offers, "cheapest")?.terminal).toBe("Hors carte");
    expect(bestOffer(offers, "best")?.terminal).toBe("Hors carte");
  });
  it("sans offre → null ; sans distance connue, « plus proche » prend le moins cher", () => {
    expect(bestOffer([], "nearest")).toBeNull();
    expect(bestOffer([placed("A", 500, null), placed("B", 400, null)], "nearest")?.terminal).toBe("B");
  });
});

describe("sortComponents", () => {
  const rows = [
    { className: "c1", grade: "C" },
    { className: "a1", grade: "A" },
    { className: "b1", grade: "B" },
    { className: "nv", grade: "A" },
  ];
  const best: Record<string, PlacedOffer | null> = {
    c1: placed("t", 100, 1),
    a1: placed("t", 900, 9),
    b1: placed("t", 500, 4),
    nv: null,
  };
  const order = (s: "nearest" | "cheapest" | "best") => sortComponents(rows, (c) => best[c.className], s).map((r) => r.className);
  it("plus proche / moins cher : composants non vendus en dernier", () => {
    expect(order("nearest")).toEqual(["c1", "b1", "a1", "nv"]);
    expect(order("cheapest")).toEqual(["c1", "b1", "a1", "nv"]);
  });
  it("meilleur : grade d'abord, prix en départage", () => {
    expect(order("best")).toEqual(["a1", "nv", "b1", "c1"]);
  });
});

describe("liste d'achats", () => {
  const line = (slot: string, terminal: string, price: number, stop: CartLine["stop"]): CartLine => ({
    slot, className: slot, name: slot, terminal, place: "", price, stop,
  });
  const lines = [
    line("shield", "Platinum Bay", 41000, { bodyId: "sera", poi: null }),
    line("cooler", "Platinum Bay", 6900, { bodyId: "sera", poi: null }),
    line("gun", "CenterMass", 33000, { bodyId: "arc", poi: "Area 18" }),
    line("qd", "Hors carte", 1000, null),
  ];
  it("total et arrêts uniques par terminal", () => {
    expect(cartSummary(lines)).toEqual({ total: 81900, stops: 3 });
    expect(cartSummary([])).toEqual({ total: 0, stops: 0 });
  });
  it("itinéraire : départ puis un arrêt par lieu, ordre au plus proche, lieux hors carte omis", () => {
    const pos: Record<string, number> = { here: 0, sera: 50, arc: 10 };
    const dist = (a: { bodyId: string }, c: { bodyId: string }) => Math.abs(pos[a.bodyId] - pos[c.bodyId]);
    expect(cartItinerary(lines, { bodyId: "here", poi: null }, dist)).toEqual([
      { bodyId: "here", poi: null },
      { bodyId: "arc", poi: "Area 18" },
      { bodyId: "sera", poi: null },
    ]);
    expect(cartItinerary(lines, null, dist)).toHaveLength(2);
  });
});
