import { describe, it, expect } from "vitest";
import { placeLabel, resolveScope, type BodyRef } from "./resolve";

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
  it("l'étoile (nommée comme le système) ne masque pas la planète", () => {
    const withStar: BodyRef[] = [
      { name: "Stanton", system: "Stanton", parentBody: null, navIcon: "Star" },
      { name: "microTech", system: "Stanton", parentBody: null, navIcon: "Planet" },
    ];
    expect(resolveScope("Stanton_microTech_NewBabbage", withStar)).toEqual({ system: "Stanton", planet: "microTech" });
  });
});

describe("codes de lieu des journaux actuels", () => {
  const STANTON: BodyRef[] = [
    { name: "Stanton", system: "Stanton", parentBody: null, navIcon: "Star" },
    { name: "Hurston", system: "Stanton", parentBody: null, navIcon: "Planet" },
    { name: "Crusader", system: "Stanton", parentBody: null, navIcon: "Planet" },
    { name: "ArcCorp", system: "Stanton", parentBody: null, navIcon: "Planet" },
    { name: "microTech", system: "Stanton", parentBody: null, navIcon: "Planet" },
  ];
  it("StantonN_Ville → planète N", () => {
    expect(resolveScope("Stanton4_NewBabbage", STANTON)).toEqual({ system: "Stanton", planet: "microTech" });
    expect(resolveScope("Stanton2_Orison", STANTON)).toEqual({ system: "Stanton", planet: "Crusader" });
  });
  it("RR_<code>_LEO → planète de la station", () => {
    expect(resolveScope("RR_CRU_LEO", STANTON)).toEqual({ system: "Stanton", planet: "Crusader" });
    expect(resolveScope("RR_MIC_LEO", STANTON)).toEqual({ system: "Stanton", planet: "microTech" });
  });
  it("noms lisibles", () => {
    expect(placeLabel("RR_CRU_LEO")).toBe("Seraphim Station");
    expect(placeLabel("RR_MIC_LEO")).toBe("Port Tressler");
    expect(placeLabel("Stanton4_NewBabbage")).toBe("New Babbage");
    expect(placeLabel("Stanton2_Orison")).toBe("Orison");
    expect(placeLabel("Zone_Inconnue")).toBe("Zone_Inconnue");
  });
});
