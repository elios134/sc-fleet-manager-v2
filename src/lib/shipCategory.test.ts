import { describe, it, expect } from "vitest";
import { normalizeRsiCategory } from "./shipCategory";

describe("normalizeRsiCategory", () => {
  it("null / vide → null", () => {
    expect(normalizeRsiCategory(null)).toBeNull();
    expect(normalizeRsiCategory(undefined)).toBeNull();
    expect(normalizeRsiCategory("")).toBeNull();
  });
  it("rôle connu → catégorie RSI", () => {
    expect(normalizeRsiCategory("Gunship")).toBe("Combat");
    expect(normalizeRsiCategory("Transporter")).toBe("Transport");
    expect(normalizeRsiCategory("Starter")).toBe("Multi-role");
  });
  it("prend le 1er segment avant '/'", () => {
    expect(normalizeRsiCategory("Combat/Heavy")).toBe("Combat");
  });
  it("rôle inconnu → repli Multi-role", () => {
    expect(normalizeRsiCategory("Zorglub")).toBe("Multi-role");
  });
});
