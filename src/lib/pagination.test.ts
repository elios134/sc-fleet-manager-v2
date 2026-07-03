import { describe, it, expect } from "vitest";
import { computePageNumbers } from "./pagination";

describe("computePageNumbers", () => {
  it("≤ fenêtre : toutes les pages, sans ellipse", () => {
    expect(computePageNumbers(1, 3)).toEqual([1, 2, 3]);
  });
  it("page au milieu : 1 … voisins … dernière", () => {
    expect(computePageNumbers(5, 10)).toEqual([1, "…", 4, 5, 6, "…", 10]);
  });
  it("près du début : pas d'ellipse à gauche", () => {
    expect(computePageNumbers(2, 10)).toEqual([1, 2, 3, "…", 10]);
  });
  it("près de la fin : pas d'ellipse à droite", () => {
    expect(computePageNumbers(9, 10)).toEqual([1, "…", 8, 9, 10]);
  });
  it("une seule page", () => {
    expect(computePageNumbers(1, 1)).toEqual([1]);
  });
});
