import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { HUBS, legacyRedirect, migratePinned, hubTabPath, tabPins } from "./navHubs";

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

describe("épingles d'onglet (issues de la migration)", () => {
  it("liste les épingles qui ne sont pas des hubs, avec leur libellé d'onglet", () => {
    expect(tabPins(["/fleet", "/fleet/assurances", "/ships/comparateur", "/inconnue"])).toEqual([
      { route: "/fleet/assurances", labelKey: "nav.tab.assurances" },
      { route: "/ships/comparateur", labelKey: "nav.tab.comparateur" },
      { route: "/inconnue", labelKey: null },
    ]);
  });
});

describe("aucun lien interne vers une ancienne route", () => {
  it("les navigate() visent les routes de hub (une redirection perdrait location.state)", () => {
    const legacy = HUBS.flatMap((h) => h.tabs.map((t) => t.legacy)).filter((p) => !HUBS.some((h) => h.path === p));
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name) && !/\.test\.|navHubs\.ts$/.test(e.name)) {
          const src = readFileSync(p, "utf8");
          for (const l of legacy) if (src.includes(`navigate("${l}"`)) hits.push(`${p} → ${l}`);
        }
      }
    };
    walk(join(__dirname, ".."));
    expect(hits).toEqual([]);
  });
});
