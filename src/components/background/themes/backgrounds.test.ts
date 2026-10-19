import { describe, it, expect } from "vitest";
import { BACKGROUNDS, DEFAULT_BACKGROUND, backgroundById } from "./backgrounds";

describe("galerie de fonds", () => {
  it("vortex par défaut, 4 fonds, ids uniques, crédit pour les captures de la communauté", () => {
    expect(DEFAULT_BACKGROUND).toBe("vortex");
    expect(BACKGROUNDS.map((b) => b.id)).toEqual(["vortex", "aurora", "constellation", "cutlass"]);
    expect(BACKGROUNDS.filter((b) => b.id !== "vortex").every((b) => !!b.author)).toBe(true);
  });
  it("le vortex tourne ; les captures restent fixes, sans zoom (retour utilisateur)", () => {
    expect(backgroundById("vortex").amp).toBeGreaterThan(0);
    for (const id of ["aurora", "constellation", "cutlass"]) {
      expect(backgroundById(id).amp).toBe(0);
    }
  });
  it("id inconnu ou vide → vortex", () => {
    expect(backgroundById("nope").id).toBe("vortex");
    expect(backgroundById(null).id).toBe("vortex");
  });
});
