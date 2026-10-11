import { describe, it, expect } from "vitest";
import { bodyKey, texUrlFor } from "./naming";

describe("bodyKey", () => {
  it("insensible casse/espaces/accents, stable VerseTime↔RSI", () => {
    expect(bodyKey("microTech")).toBe("microtech");
    expect(bodyKey("  microtech ")).toBe("microtech");
    expect(bodyKey("ArcCorp")).toBe("arccorp");
    expect(bodyKey("Yela")).toBe(bodyKey("yela"));
  });
});
describe("texUrlFor", () => {
  it("construit une URL jsDelivr .webp depuis la clé", () => {
    expect(texUrlFor("microTech")).toBe(
      "https://cdn.jsdelivr.net/gh/elios134/sc-fleet-starmap-data@main/planets/microtech.webp",
    );
  });
});
