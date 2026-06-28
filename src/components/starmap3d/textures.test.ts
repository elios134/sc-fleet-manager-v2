import { describe, it, expect } from "vitest";
import { textureKindFor } from "./textures";

describe("textureKindFor", () => {
  it("mappe les appearances connues", () => {
    expect(textureKindFor("PLANET_GREEN")).toBe("green");
    expect(textureKindFor("PLANET_GAS")).toBe("gas");
    expect(textureKindFor("PLANET_BROWN")).toBe("brown");
    expect(textureKindFor("PLANET_BLUE")).toBe("blue");
  });
  it("DEFAULT / null / inconnu → rock", () => {
    expect(textureKindFor("DEFAULT")).toBe("rock");
    expect(textureKindFor(null)).toBe("rock");
    expect(textureKindFor("PLANET_WTF")).toBe("rock");
  });
});
