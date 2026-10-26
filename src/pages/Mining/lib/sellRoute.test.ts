import { describe, it, expect } from "vitest";
import { sellStops } from "./sellRoute";
import type { StarmapBodyItem } from "../../../components/starmap3d/starmapData";
import type { SellPoint } from "../types";

const body = (id: string, name: string, navIcon: string): StarmapBodyItem =>
  ({ id, recordName: name, systemName: "Stanton", navIcon, name, parentRef: null }) as StarmapBodyItem;
const BODIES = [body("b1", "CRU-L1 Ambitious Dream Station", "Station"), body("b2", "Hurston", "Planet")];
const sp = (mineral: string, station: string | null, planet: string | null = null): SellPoint => ({
  mineral,
  terminal: "T",
  system: "Stanton",
  priceSell: 1,
  scuDemand: 1,
  updatedAt: null,
  live: true,
  place: { system: "Stanton", planet, moon: null, station, city: null, outpost: null },
});

describe("sellStops", () => {
  it("un arrêt par point de vente placé sur la carte, sans doublon, dans l'ordre", () => {
    const stops = sellStops([sp("titanium", "CRU-L1"), sp("laranite", null, "Hurston"), sp("agricium", "CRU-L1")], BODIES);
    expect(stops).toEqual([
      { bodyId: "b1", poi: null },
      { bodyId: "b2", poi: null },
    ]);
  });

  it("point de vente sans lieu ou introuvable sur la carte : ignoré", () => {
    expect(sellStops([{ ...sp("x", null), place: null }, sp("y", "Nulle Part")], BODIES)).toEqual([]);
  });
});
