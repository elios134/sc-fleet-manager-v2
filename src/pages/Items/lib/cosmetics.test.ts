import { describe, expect, it } from "vitest";
import { cosmeticKind, groupPacks, inFleet, packKindCounts, shipFor, shipOfTitle, viewPacks } from "./cosmetics";
import type { HangarItem } from "../types";

const PLEDGE: Record<string, number> = { "Gear - CitizenCon Pack": 10, "IAE Academy 2954 - Reward": 20, "Gear - Streamline - Bundle": 30 };
const item = (id: number, title: string, kind: string | null, pledgeName: string, manufacturer: string | null = null): HangarItem => ({
  id, pledgeId: PLEDGE[pledgeName] ?? 99, accountId: "a", title, kind, imageUrl: null, manufacturer, pledgeName, pledgeValueUsd: 45, pledgeCreatedDate: "2024-10-19",
});
const ITEMS = [
  item(1, "Scorpius - IceBreak Paint", "Skin", "Gear - CitizenCon Pack"),
  item(2, "Tailwind Helmet Murray Cup", null, "Gear - CitizenCon Pack"),
  item(3, "Wastelander Undersuit", "FPS Equipment", "IAE Academy 2954 - Reward"),
  item(4, "L-21 Wolf TSB Flight Blade", "Component", "IAE Academy 2954 - Reward", "Kruger"),
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

describe("shipFor", () => {
  it("vaisseau concerné seulement pour les peintures et composants", () => {
    expect(shipFor(ITEMS[0]!)).toBe("Scorpius");
    expect(shipFor(item(8, "Pyro - Mining Outpost Poster", "Hangar decoration", "p"))).toBeNull();
    expect(shipFor(item(9, "Overlord - Helmet", "FPS Equipment", "p"))).toBeNull();
  });
});

describe("groupPacks / viewPacks / packKindCounts", () => {
  const packs = groupPacks(ITEMS);
  it("un pack par pledge, avec ses objets, sa valeur et sa date ; triés par nom", () => {
    expect(packs.map((p) => [p.id, p.name, p.items.length])).toEqual([
      [10, "Gear - CitizenCon Pack", 2],
      [30, "Gear - Streamline - Bundle", 1],
      [20, "IAE Academy 2954 - Reward", 2],
    ]);
    expect(packs[0]).toMatchObject({ valueUsd: 45, createdDate: "2024-10-19" });
  });
  it("pledge sans nom → nom de repli fourni", () => {
    const [p] = groupPacks([{ ...ITEMS[0]!, pledgeName: null }], (id) => `Pledge #${id}`);
    expect(p!.name).toBe("Pledge #10");
  });
  it("recherche sur le pack ou sur le titre, le type ou le fabricant d'un objet, sans accents", () => {
    expect(viewPacks(packs, { q: "icebreak", kind: "all" }).map((p) => p.id)).toEqual([10]);
    expect(viewPacks(packs, { q: "académy", kind: "all" }).map((p) => p.id)).toEqual([20]);
    expect(viewPacks(packs, { q: "kruger", kind: "all" }).map((p) => p.id)).toEqual([20]);
    expect(viewPacks(packs, { q: "hangar decoration", kind: "all" }).map((p) => p.id)).toEqual([30]);
  });
  it("filtre : un pack correspond s'il contient au moins un objet du type", () => {
    expect(viewPacks(packs, { q: "", kind: "other" }).map((p) => p.id)).toEqual([10]);
    expect(viewPacks(packs, { q: "", kind: "comp" }).map((p) => p.id)).toEqual([20]);
  });
  it("compteurs = nombre de packs par type, sur tout le hangar", () => {
    expect(packKindCounts(packs)).toEqual({ all: 3, fps: 1, skin: 1, comp: 1, deco: 1, other: 1 });
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
