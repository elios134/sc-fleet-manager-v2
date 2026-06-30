import { describe, it, expect } from "vitest";
import { groupFeaturesByCategory } from "./featureGroups";

const cats = [{ key: "ships" }, { key: "commerce" }, { key: "info" }];
const items = [
  { to: "/fleet", category: "ships" },
  { to: "/ccu-chain", category: "ships" },
  { to: "/cargo-routes", category: "commerce" },
  { to: "/news", category: "info" },
];

describe("groupFeaturesByCategory", () => {
  it("regroupe par catégorie dans l'ordre fourni", () => {
    const g = groupFeaturesByCategory(items, cats, []);
    expect(g.map((x) => x.category.key)).toEqual(["ships", "commerce", "info"]);
    expect(g[0].items.map((i) => i.to)).toEqual(["/fleet", "/ccu-chain"]);
  });

  it("exclut les raccourcis épinglés", () => {
    const g = groupFeaturesByCategory(items, cats, ["/fleet"]);
    const ships = g.find((x) => x.category.key === "ships");
    expect(ships?.items.map((i) => i.to)).toEqual(["/ccu-chain"]);
  });

  it("omet une catégorie devenue vide (tous épinglés)", () => {
    const g = groupFeaturesByCategory(items, cats, ["/news"]);
    expect(g.some((x) => x.category.key === "info")).toBe(false);
  });

  it("liste vide si tout est épinglé", () => {
    const g = groupFeaturesByCategory(items, cats, items.map((i) => i.to));
    expect(g).toEqual([]);
  });
});
