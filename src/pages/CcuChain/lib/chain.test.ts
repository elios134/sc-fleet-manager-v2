import { describe, it, expect } from "vitest";
import { chainNodes, shipChoices, sortPaths } from "./chain";
import type { CcuPath, CcuShip, Step } from "../types";

const ship = (shipId: number, over: Partial<CcuShip> = {}): CcuShip => ({
  shipId,
  name: `Ship ${shipId}`,
  manufacturer: null,
  focus: null,
  imageUrl: null,
  priceCents: shipId * 1000,
  priceSource: "ccu",
  isWarbondPrice: false,
  standardPriceCents: null,
  isOwned: false,
  isAvailable: true,
  ...over,
});
const step = (from: number, to: number, cost: number, ownedSource = false): Step => ({
  fromShipId: from,
  toShipId: to,
  toSkuId: to * 10,
  toSkuPriceCents: to * 1000,
  upgradePriceCents: cost,
  isOwnedSourceShip: ownedSource,
});
const path = (steps: Step[], total: number, over: Partial<CcuPath> = {}): CcuPath => ({
  steps,
  totalCostCents: total,
  stepCount: steps.length,
  directCostCents: 10000,
  savingCents: 10000 - total,
  warbondEndIndex: null,
  ...over,
});

describe("chainNodes", () => {
  const byId = new Map([1, 2, 3, 4].map((id) => [id, ship(id)]));

  it("départ, étapes puis cible, avec le coût de chaque montée", () => {
    const nodes = chainNodes(path([step(1, 2, 1500, true), step(2, 4, 2500)], 4000), byId);
    expect(nodes.map((n) => [n.shipId, n.role, n.stepCostCents])).toEqual([
      [1, "owned", null],
      [2, "step", 1500],
      [4, "goal", 2500],
    ]);
    expect(nodes[1]!.name).toBe("Ship 2");
  });

  it("un vaisseau intermédiaire déjà possédé est marqué possédé ; départ non possédé = étape", () => {
    const nodes = chainNodes(path([step(1, 2, 1500), step(2, 3, 1000, true), step(3, 4, 900)], 3400), byId);
    expect(nodes.map((n) => n.role)).toEqual(["step", "owned", "step", "goal"]);
  });

  it("étiquette warbond jusqu'à warbondEndIndex, standard après ; aucune si pas de warbond", () => {
    const steps = [step(1, 2, 1500), step(2, 3, 1000), step(3, 4, 900)];
    expect(chainNodes(path(steps, 3400, { warbondEndIndex: 0 }), byId).map((n) => n.tag)).toEqual(["none", "warbond", "standard", "standard"]);
    expect(chainNodes(path(steps, 3400), byId).map((n) => n.tag)).toEqual(["none", "none", "none", "none"]);
  });

  it("vaisseau inconnu → nom de repli, prix nul ; chemin vide → aucun nœud", () => {
    const nodes = chainNodes(path([step(1, 9, 500)], 500), byId);
    expect(nodes[1]).toMatchObject({ name: "Ship #9", priceCents: null });
    expect(chainNodes(path([], 0), byId)).toEqual([]);
  });
});

describe("shipChoices", () => {
  const ships = [
    ship(3, { name: "Corsair" }),
    ship(1, { name: "Clipper", isOwned: true }),
    ship(2, { name: "Ship #2" }),
    ship(4, { name: "Avenger", priceSource: "msrp" }),
    ship(5, { name: "Aurora", isOwned: true, priceSource: null }),
  ];

  it("départ : possédés d'abord puis les autres, triés par nom, sans noms non résolus", () => {
    const c = shipChoices(ships, "from");
    expect(c.owned.map((s) => s.name)).toEqual(["Aurora", "Clipper"]);
    expect(c.others.map((s) => s.name)).toEqual(["Avenger", "Corsair"]);
  });

  it("cible : seulement les vaisseaux achetables en CCU", () => {
    const c = shipChoices(ships, "to");
    expect(c.owned.map((s) => s.name)).toEqual(["Clipper"]);
    expect(c.others.map((s) => s.name)).toEqual(["Corsair"]);
  });

  it("filtres : ma flotte, disponibles, warbond (cumulables)", () => {
    const more = [...ships, ship(6, { name: "Zeus", isWarbondPrice: true }), ship(7, { name: "Hull A", isAvailable: false })];
    const names = (f: Parameters<typeof shipChoices>[2]) => {
      const c = shipChoices(more, "from", f);
      return [...c.owned, ...c.others].map((s) => s.name);
    };
    expect(names({ owned: true })).toEqual(["Aurora", "Clipper"]);
    expect(names({ warbond: true })).toEqual(["Zeus"]);
    expect(names({ available: true })).not.toContain("Hull A");
    expect(names({ owned: true, warbond: true })).toEqual([]);
  });

  it("le vaisseau déjà choisi reste proposé même si un filtre l'écarte", () => {
    const c = shipChoices(ships, "from", { owned: true }, 3);
    expect(c.owned.map((s) => s.name)).toEqual(["Aurora", "Clipper"]);
    expect(c.others.map((s) => s.name)).toEqual(["Corsair"]);
  });
});

describe("sortPaths", () => {
  const paths = [
    path([step(1, 2, 1), step(2, 4, 1)], 8000, { savingCents: 2000 }),
    path([step(1, 4, 1)], 8000, { savingCents: 2000 }),
    path([step(1, 3, 1), step(3, 4, 1)], 9000, { savingCents: null }),
  ];

  it("coût : moins cher d'abord, puis moins d'étapes ; garde l'index d'origine", () => {
    expect(sortPaths(paths, "cost").map((x) => x.originalIndex)).toEqual([1, 0, 2]);
  });

  it("économie : plus grosse d'abord, économie inconnue en dernier", () => {
    expect(sortPaths(paths, "saving").map((x) => x.originalIndex)).toEqual([0, 1, 2]);
  });
});
