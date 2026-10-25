import { describe, expect, it } from "vitest";
import { cosmeticKind, inFleet, kindCounts, shipOfTitle, viewCosmetics } from "./cosmetics";
import type { HangarItem } from "../types";

const item = (id: number, title: string, kind: string | null, pledgeName: string): HangarItem => ({
  id, pledgeId: id, accountId: "a", title, kind, imageUrl: null, manufacturer: null, pledgeName, pledgeValueUsd: null, pledgeCreatedDate: null,
});
const ITEMS = [
  item(1, "Scorpius - IceBreak Paint", "Skin", "Gear - CitizenCon Pack"),
  item(2, "Tailwind Helmet Murray Cup", null, "Gear - CitizenCon Pack"),
  item(3, "Wastelander Undersuit", "FPS Equipment", "IAE Academy 2954 - Reward"),
  item(4, "L-21 Wolf TSB Flight Blade", "Component", "IAE Academy 2954 - Reward"),
  item(5, "Levski Coin", "Hangar decoration", "Gear - Streamline - Bundle"),
];

describe("cosmeticKind", () => {
  it("classe les kinds RSI, le reste (et null) en « other »", () => {
    expect(ITEMS.map(cosmeticKind)).toEqual(["skin", "other", "fps", "comp", "deco"]);
    expect(cosmeticKind(item(9, "x", "Weird", "p"))).toBe("other");
  });
});

describe("shipOfTitle", () => {
  it("vaisseau = partie avant « - » d'une peinture ou d'un composant", () => {
    expect(shipOfTitle("Scorpius - IceBreak Paint")).toBe("Scorpius");
    expect(shipOfTitle("Aurora Mk II - Streamline Paint")).toBe("Aurora Mk II");
  });
  it("null sans séparateur", () => {
    expect(shipOfTitle("Levski Coin")).toBeNull();
  });
});

describe("viewCosmetics / kindCounts", () => {
  it("recherche sur le titre et le pack, sans casse ni accents", () => {
    expect(viewCosmetics(ITEMS, { q: "icebreak", kind: "all" }).map((i) => i.id)).toEqual([1]);
    expect(viewCosmetics(ITEMS, { q: "académy", kind: "all" }).map((i) => i.id)).toEqual([4, 3]);
  });
  it("filtre par type, résultat trié par titre", () => {
    expect(viewCosmetics(ITEMS, { q: "", kind: "other" }).map((i) => i.id)).toEqual([2]);
    expect(viewCosmetics(ITEMS, { q: "", kind: "all" }).map((i) => i.id)).toEqual([4, 5, 1, 2, 3]);
  });
  it("compte par type (tout le hangar)", () => {
    expect(kindCounts(ITEMS)).toEqual({ all: 5, fps: 1, skin: 1, comp: 1, deco: 1, other: 1 });
  });
});

describe("inFleet", () => {
  const fleet = ["L-22 Alpha Wolf", "Aurora Mk II", "Perseus"];
  it("vrai si un vaisseau de la flotte contient tous les mots du vaisseau concerné", () => {
    expect(inFleet("Wolf", fleet)).toBe(true);
    expect(inFleet("aurora mk ii", fleet)).toBe(true);
  });
  it("faux sinon", () => {
    expect(inFleet("Scorpius", fleet)).toBe(false);
  });
});
