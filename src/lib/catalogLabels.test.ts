import { describe, it, expect } from "vitest";
import { catLabel } from "./catalogLabels";

describe("catLabel", () => {
  it("traduit en FR, garde l'anglais ailleurs ou si inconnu", () => {
    expect(catLabel("Stealth", "fr")).toBe("Furtif");
    expect(catLabel("Stealth", "fr-FR")).toBe("Furtif");
    expect(catLabel("Stealth", "en")).toBe("Stealth");
    expect(catLabel("Inconnu", "fr")).toBe("Inconnu");
    expect(catLabel(null, "fr")).toBe("");
  });
});
