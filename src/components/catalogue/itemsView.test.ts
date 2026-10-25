import { describe, expect, it } from "vitest";
import { itemMakers, pageOf, sectionCounts, viewItems, type CatalogItem } from "./itemsView";

const item = (id: number, name: string, section: string, companyName: string, minPrice: number | null, sellPoints: number): CatalogItem => ({
  id, uuid: null, name, section, category: null, companyName, size: null, imageUrl: null, sellPoints, minPrice,
});
const ITEMS = [
  item(1, "P4-AR Rifle", "Personal Weapons", "Behring", 4757, 2),
  item(2, "Arclight Pistol", "Personal Weapons", "Klaus & Werner", 1014, 12),
  item(3, "Horizon Helmet", "Armor", "RSI", 1522, 10),
  item(4, "Mystère", "Armor", "RSI", null, 0),
];

describe("viewItems", () => {
  it("sans filtre : tout le catalogue, trié par nom", () => {
    expect(viewItems(ITEMS, { q: "", maker: "", section: "", sort: "name" }).map((i) => i.id)).toEqual([2, 3, 4, 1]);
  });
  it("recherche sur le nom ou le fabricant, sans tenir compte de la casse ni des accents", () => {
    expect(viewItems(ITEMS, { q: "klaus", maker: "", section: "", sort: "name" }).map((i) => i.id)).toEqual([2]);
    expect(viewItems(ITEMS, { q: "mystere", maker: "", section: "", sort: "name" }).map((i) => i.id)).toEqual([4]);
  });
  it("filtre par fabricant et par rayon", () => {
    expect(viewItems(ITEMS, { q: "", maker: "RSI", section: "", sort: "name" }).map((i) => i.id)).toEqual([3, 4]);
    expect(viewItems(ITEMS, { q: "", maker: "", section: "Personal Weapons", sort: "name" }).map((i) => i.id)).toEqual([2, 1]);
  });
  it("tri par prix (sans prix en dernier) et par nombre de points de vente", () => {
    expect(viewItems(ITEMS, { q: "", maker: "", section: "", sort: "price" }).map((i) => i.id)).toEqual([2, 3, 1, 4]);
    expect(viewItems(ITEMS, { q: "", maker: "", section: "", sort: "points" }).map((i) => i.id)).toEqual([2, 3, 1, 4]);
  });
});

describe("sectionCounts / itemMakers / pageOf", () => {
  it("compte par rayon, du plus fourni au moins fourni", () => {
    expect(sectionCounts(ITEMS)).toEqual([["Armor", 2], ["Personal Weapons", 2]]);
  });
  it("fabricants uniques triés", () => {
    expect(itemMakers(ITEMS)).toEqual(["Behring", "Klaus & Werner", "RSI"]);
  });
  it("affiche les N premiers et dit s'il en reste", () => {
    expect(pageOf(ITEMS, 3)).toEqual({ shown: ITEMS.slice(0, 3), rest: 1 });
    expect(pageOf(ITEMS, 60)).toEqual({ shown: ITEMS, rest: 0 });
  });
});
