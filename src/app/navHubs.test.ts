import { describe, it, expect } from "vitest";
import { HUBS, legacyRedirect, migratePinned, hubTabPath } from "./navHubs";

describe("legacyRedirect", () => {
  it("ancienne route → hub/onglet", () => {
    expect(legacyRedirect("/insurance")).toBe("/fleet/assurances");
    expect(legacyRedirect("/comparator")).toBe("/ships/comparateur");
    expect(legacyRedirect("/intel")).toBe("/missions/hub");
    expect(legacyRedirect("/items")).toBe("/market/cosmetiques");
  });
  it("routes de hub ou inconnues → null", () => {
    expect(legacyRedirect("/fleet")).toBeNull();
    expect(legacyRedirect("/starmap")).toBeNull();
    expect(legacyRedirect("/inconnue")).toBeNull();
  });
});

describe("migratePinned", () => {
  it("mappe, dédoublonne, retire Actualités", () => {
    expect(migratePinned(["/insurance", "/fleet/assurances", "/news", "/starmap"])).toEqual(["/fleet/assurances", "/starmap"]);
  });
});

describe("HUBS", () => {
  it("9 hubs couvrant les 18 entrées (19 − Actualités)", () => {
    expect(HUBS.length).toBe(9);
    expect(HUBS.flatMap((h) => h.tabs).length + HUBS.filter((h) => h.tabs.length === 0).length).toBe(18);
  });
  it("hubTabPath", () => {
    expect(hubTabPath("ships", "3d")).toBe("/ships/3d");
  });
});
