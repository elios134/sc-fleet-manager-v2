import { describe, it, expect } from "vitest";
import { BACKGROUNDS, DEFAULT_BACKGROUND, backgroundById } from "./backgrounds";

describe("galerie de fonds", () => {
  it("deux fonds : Vortex cosmique (par défaut) et Ciel étoilé", () => {
    expect(DEFAULT_BACKGROUND).toBe("vortex");
    expect(BACKGROUNDS.map((b) => b.id)).toEqual(["vortex", "stars"]);
  });
  it("fond retiré (aurora, constellation, cutlass), inconnu ou vide → vortex", () => {
    for (const id of ["aurora", "constellation", "cutlass", "nope", null]) expect(backgroundById(id).id).toBe("vortex");
    expect(backgroundById("stars").id).toBe("stars");
  });
});
