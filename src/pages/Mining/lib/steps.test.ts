import { describe, it, expect } from "vitest";
import { stepsState, refinedMaterials } from "./steps";
import { methodByKey } from "../../../lib/miningRegistry";

describe("stepsState", () => {
  it("chargement saisi : les 4 étapes ouvertes, étape courante gardée", () => {
    expect(stepsState(32, 2)).toEqual({ current: 2, enabled: [true, true, true, true] });
  });

  it("aucun minerai : seule l'étape 1 est ouverte et on y revient", () => {
    expect(stepsState(0, 3)).toEqual({ current: 0, enabled: [true, false, false, false] });
  });

  it("étape mémorisée hors bornes ou invalide → bornée", () => {
    expect(stepsState(10, 9).current).toBe(3);
    expect(stepsState(10, -2).current).toBe(0);
    expect(stepsState(10, Number.NaN).current).toBe(0);
  });
});

describe("refinedMaterials", () => {
  it("quantités raffinées par minéral selon le rendement de la méthode, plus grosse d'abord", () => {
    const key = Object.keys(methodByKey)[0]!;
    const y = methodByKey[key]!.yieldMult;
    const r = refinedMaterials([{ key: "quantanium", scu: 10 }, { key: "bexalite", scu: 30 }, { key: "inconnu", scu: 5 }, { key: "taranite", scu: 0 }], key);
    expect(r.map((m) => m.key)).toEqual(["bexalite", "quantanium"]);
    expect(r[0]).toEqual({ key: "bexalite", name: "Bexalite", refinedScu: 30 * y });
  });

  it("sans méthode : rendement 1", () => {
    expect(refinedMaterials([{ key: "quantanium", scu: 4 }], null)[0]!.refinedScu).toBe(4);
  });
});
