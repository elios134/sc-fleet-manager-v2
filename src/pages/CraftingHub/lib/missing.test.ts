import { describe, it, expect } from "vitest";
import type { StarmapBodyItem } from "../../../components/starmap3d/starmapData";
import { craftNeeds, ownedFromInventory, sortSpots, spotStop, type MiningSpot } from "./missing";

const ing = (ref: string, name: string, type: string, quantity: number) => ({ ingredientRef: ref, ingredientName: name, ingredientType: type, quantity });

describe("craftNeeds", () => {
  const ings = [ing("had", "Hadanite", "item", 6), ing("tar", "Taranite", "resource", 0.35), ing("tar", "Taranite", "resource", 0.15), ing("cu", "Copper", "resource", 1)];
  it("besoin = recette × quantité, cumulé par ingrédient ; manque = besoin − possédé", () => {
    const n = craftNeeds(ings, 2, { had: 4, cu: 5 });
    expect(n).toEqual([
      { ref: "had", name: "Hadanite", resource: false, need: 12, owned: 4, missing: 8 },
      { ref: "tar", name: "Taranite", resource: true, need: 1, owned: 0, missing: 1 },
      { ref: "cu", name: "Copper", resource: true, need: 2, owned: 5, missing: 0 },
    ]);
  });
  it("arrondi au centième de SCU (pas de 0,30000000000000004)", () => {
    expect(craftNeeds([ing("a", "A", "resource", 0.1)], 3, {})[0].need).toBe(0.3);
  });
});

describe("ownedFromInventory", () => {
  const possessions = {
    "Area 18": { Hadanite_Gem_01: { qte: 3, vu: 1 }, medpen: { qte: 2, vu: 1 } },
    Lorville: { hadanite_gem_01: { qte: 2, vu: 1 } },
  };
  it("somme des objets dont la classe contient le nom de l'ingrédient, tous lieux confondus", () => {
    expect(ownedFromInventory("Hadanite", possessions)).toBe(5);
  });
  it("absent de l'inventaire → null (pas de pré-remplissage)", () => {
    expect(ownedFromInventory("Janalite", possessions)).toBeNull();
  });
});

const b = (id: string, name: string, navIcon: string, system = "stanton"): StarmapBodyItem => ({
  id, recordName: id, systemName: system, navIcon, name, description: null, size: null, parentRef: null,
  hideInStarmap: false, showOrbitLine: true, orbitOrder: null, source: "rsi", lastSyncedAt: null,
  posX: null, posY: null, posZ: null, wikiUuid: id, appearance: null, habitable: null, distance: null,
  longitude: null, latitude: null, subtype: null, affColor: null,
});
const spot = (bodyName: string, method: string, gm: number | null, rarity: string | null = null, raw = ""): MiningSpot => ({
  systemName: "stanton", rawBodyKey: raw, bodyName, miningMethod: method, rarity, gm,
});

describe("spotStop", () => {
  const bodies = [b("hur", "Hurston", "Planet"), b("halo", "Aaron Halo", "AsteroidBelt"), b("ring", "Glaciem Ring", "AsteroidBelt", "nyx")];
  it("par nom du corps, sinon par la clé brute sans préfixe de système", () => {
    expect(spotStop(spot("Hurston", "fps", null), bodies)).toEqual({ bodyId: "hur", poi: null });
    expect(spotStop(spot("Aaronhalo", "ship", null, null, "aaronhalo"), bodies)).toEqual({ bodyId: "halo", poi: null });
    expect(spotStop({ ...spot("Nyx Glaciemring", "ship", null, null, "nyx_glaciemring"), systemName: "nyx" }, bodies)).toEqual({ bodyId: "ring", poi: null });
  });
  it("lieu absent de la carte (Lagrange) → null", () => {
    expect(spotStop(spot("Lagrange A", "ship", null, null, "lagrange_a"), bodies)).toBeNull();
  });
});

describe("sortSpots", () => {
  it("méthode choisie d'abord, puis distance (inconnue en dernier), puis rareté", () => {
    const list = [spot("Lyria", "ground_vehicle", 3.6), spot("Aberdeen", "fps", 1.4), spot("Daymar", "ground_vehicle", 2.1), spot("Loin", "ground_vehicle", null)];
    expect(sortSpots(list, "roc").map((s) => s.bodyName)).toEqual(["Daymar", "Lyria", "Loin", "Aberdeen"]);
    expect(sortSpots(list, "fps").map((s) => s.bodyName)).toEqual(["Aberdeen", "Daymar", "Lyria", "Loin"]);
  });
  it("à distance égale, le plus commun d'abord", () => {
    const list = [spot("Rare", "ship", null, "rare"), spot("Commun", "ship", null, "common")];
    expect(sortSpots(list, "ship").map((s) => s.bodyName)).toEqual(["Commun", "Rare"]);
  });
});
