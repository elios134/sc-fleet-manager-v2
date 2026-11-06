import { describe, it, expect } from "vitest";
import { filterPackShips, packInsuranceTone, toShipRow } from "./packView";
import type { PackShip } from "../types";

const ship = (over: Partial<PackShip>): PackShip => ({
  shipId: 1,
  shipName: "Perseus",
  manufacturer: "Roberts Space Industries",
  role: "Heavy Gunship",
  lti: 0,
  insuranceDuration: 120,
  insuranceExpiry: null,
  imageUrl: null,
  ...over,
});

describe("filterPackShips", () => {
  const list = [ship({ shipName: "Perseus" }), ship({ shipName: "Clipper", manufacturer: "Drake Interplanetary" })];
  it("recherche sur le nom ou le fabricant, sans casse ; vide = tout", () => {
    expect(filterPackShips(list, "CLIP").map((s) => s.shipName)).toEqual(["Clipper"]);
    expect(filterPackShips(list, "drake").map((s) => s.shipName)).toEqual(["Clipper"]);
    expect(filterPackShips(list, "  ")).toHaveLength(2);
  });
});

describe("packInsuranceTone", () => {
  it("LTI d'abord, moins de 12 mois = courte, sans durée = inconnue, sinon normale", () => {
    expect(packInsuranceTone(ship({ lti: 1, insuranceDuration: 6 }))).toBe("lti");
    expect(packInsuranceTone(ship({ insuranceDuration: 6 }))).toBe("short");
    expect(packInsuranceTone(ship({ insuranceDuration: null }))).toBe("unknown");
    expect(packInsuranceTone(ship({ insuranceDuration: 120 }))).toBe("ok");
    expect(packInsuranceTone(ship({ lti: null, insuranceDuration: 12 }))).toBe("ok");
  });
});

describe("toShipRow", () => {
  it("donne la forme attendue par la fiche vaisseau ; rôle absent → MULTI", () => {
    const r = toShipRow(ship({ shipId: 7, role: null, lti: 1 }));
    expect(r).toMatchObject({ id: 7, name: "Perseus", role: "MULTI", lti: 1, acquisition: "rsi" });
  });
});
