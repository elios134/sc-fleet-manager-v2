import { describe, it, expect } from "vitest";
import { resolveScope, type BodyRef } from "./resolve";

const BODIES: BodyRef[] = [
  { name: "microTech", system: "Stanton", parentBody: null, navIcon: "Planet" },
  { name: "Hurston", system: "Stanton", parentBody: null, navIcon: "Planet" },
  { name: "Yela", system: "Stanton", parentBody: "Crusader", navIcon: "Moon" },
];
describe("resolveScope", () => {
  it("déduit système + planète depuis un nom de lieu contenant le corps", () => {
    expect(resolveScope("Stanton_microTech_NewBabbage", BODIES)).toEqual({ system: "Stanton", planet: "microTech" });
  });
  it("lune reconnue", () => {
    expect(resolveScope("Yela_ArcheCivic", BODIES)).toEqual({ system: "Stanton", planet: "Yela" });
  });
  it("non résolu → nulls", () => {
    expect(resolveScope("Zone_Inconnue", BODIES)).toEqual({ system: null, planet: null });
    expect(resolveScope(null, BODIES)).toEqual({ system: null, planet: null });
  });
});
