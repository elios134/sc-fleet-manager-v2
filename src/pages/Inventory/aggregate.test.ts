import { describe, it, expect } from "vitest";
import { buildScopeTree, rowsForMoi, rowsForPlace, categorie } from "./aggregate";
import type { InvState } from "./types";
import type { BodyRef } from "./resolve";

const BODIES: BodyRef[] = [{ name: "microTech", system: "Stanton", parentBody: null, navIcon: "Planet" }];
const STATE: InvState = {
  possessions: {
    MOI: { weapon_personal_behr_p4ar: { qte: 1, vu: 10 } },
    "L:555": { fps_consumable_medpen: { qte: 24, vu: 12 } },
  },
  sol: {},
  lieux: { "555": { code: null, nom: "Stanton_microTech_NewBabbage" } },
  contenants: {},
  derniereTrace: 12,
  journalId: null,
  journalPos: 0,
  curLocNom: null,
};

describe("buildScopeTree", () => {
  it("n'inclut que les scopes non vides", () => {
    const t = buildScopeTree(STATE, BODIES);
    expect(t.systems.map((s) => s.name)).toEqual(["Stanton"]);
    expect(t.moiCount).toBe(1);
    expect(t.placesByPlanet["microTech"].map((p) => p.name)).toContain("Stanton_microTech_NewBabbage");
  });
});
describe("contenants", () => {
  const WITH_BOX: InvState = {
    possessions: { "L:555": { a: { qte: 2, vu: 1 } }, "C:42": { b: { qte: 3, vu: 1 } } },
    sol: {},
    lieux: { "555": { code: null, nom: "Stanton_microTech_NewBabbage" } },
    contenants: { "42": { classe: "", scu: 0, lieu: 555 } },
    derniereTrace: 1, journalId: null, journalPos: 0, curLocNom: null,
  };
  it("compte le contenu d'un contenant sous son lieu parent", () => {
    const t = buildScopeTree(WITH_BOX, BODIES);
    const place = t.placesByPlanet["microTech"].find((p) => p.locId === "555");
    expect(place?.count).toBe(5); // 2 (local) + 3 (contenant)
  });
  it("rowsForPlace inclut les objets du contenant du lieu", () => {
    expect(rowsForPlace(WITH_BOX, "555").map((r) => r.classe)).toContain("b");
  });
});
describe("rowsForMoi + categorie", () => {
  it("mappe classe → catégorie et nom", () => {
    expect(categorie("weapon_personal_behr_p4ar")).toBe("Armes");
    const rows = rowsForMoi(STATE);
    expect(rows[0].categorie).toBe("Armes");
    expect(rows[0].qte).toBe(1);
  });
});
