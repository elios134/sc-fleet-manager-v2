import { describe, it, expect } from "vitest";
import { buildScopeTree, rowsForMoi, categorie } from "./aggregate";
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
};

describe("buildScopeTree", () => {
  it("n'inclut que les scopes non vides", () => {
    const t = buildScopeTree(STATE, BODIES);
    expect(t.systems.map((s) => s.name)).toEqual(["Stanton"]);
    expect(t.moiCount).toBe(1);
    expect(t.placesByPlanet["microTech"].map((p) => p.name)).toContain("Stanton_microTech_NewBabbage");
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
