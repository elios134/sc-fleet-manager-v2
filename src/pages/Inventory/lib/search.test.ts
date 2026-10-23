import { describe, it, expect } from "vitest";
import type { InvState, ItemMeta } from "../types";
import { highlight, itemPlaces, pushRecent, searchItems } from "./search";

const STATE: InvState = {
  possessions: {
    MOI: { weapon_personal_p4ar: { qte: 1, vu: 300 } },
    "L:1": { weapon_personal_p4ar: { qte: 2, vu: 100 }, char_armor_aril_torso: { qte: 1, vu: 120 }, item_multitool: { qte: 1, vu: 90 } },
    "L:2": { char_armor_aril_torso: { qte: 1, vu: 200 } },
    "C:9": { weapon_personal_p4ar: { qte: 3, vu: 250 } },
  },
  sol: {},
  lieux: { "1": { code: null, nom: "Stanton4_NewBabbage" }, "2": { code: null, nom: "RR_CRU_LEO" } },
  contenants: { "9": { classe: "box", scu: 1, lieu: 1 } },
  derniereTrace: null,
  journalId: null,
  journalPos: 0,
  curLocNom: null,
};
const META: Record<string, ItemMeta> = {
  weapon_personal_p4ar: { name: "P4-AR Rifle", imageUrl: null, classification: "FPS.Weapon.Rifle" },
  char_armor_aril_torso: { name: "Aril Torse Armuré", imageUrl: null, classification: "FPS.Armor.Torso" },
  item_multitool: { name: "Pyro RYT Multi-Tool", imageUrl: null, classification: "FPS.Utility.MultiTool" },
};

describe("itemPlaces", () => {
  it("regroupe par lieu (contenants repliés sur leur lieu), « sur moi » à part, plus grande quantité d'abord", () => {
    expect(itemPlaces(STATE).get("weapon_personal_p4ar")).toEqual([
      { key: "L:1", raw: "Stanton4_NewBabbage", qte: 5, vu: 250 },
      { key: "MOI", raw: null, qte: 1, vu: 300 },
    ]);
  });
});

describe("searchItems", () => {
  it("recherche insensible aux accents et à la casse, sur le nom ou la classe", () => {
    expect(searchItems(STATE, META, "armure", "all").map((h) => h.classe)).toEqual(["char_armor_aril_torso"]);
    expect(searchItems(STATE, META, "ARMURÉ", "all").map((h) => h.classe)).toEqual(["char_armor_aril_torso"]);
    expect(searchItems(STATE, META, "p4ar", "all")[0]).toMatchObject({ nom: "P4-AR Rifle", total: 6 });
  });
  it("filtre de catégorie : armes, armures, outils", () => {
    expect(searchItems(STATE, META, "", "weapons").map((h) => h.classe)).toEqual(["weapon_personal_p4ar"]);
    expect(searchItems(STATE, META, "", "armor").map((h) => h.classe)).toEqual(["char_armor_aril_torso"]);
    expect(searchItems(STATE, META, "", "tools").map((h) => h.classe)).toEqual(["item_multitool"]);
  });
  it("le nom qui commence par la recherche passe devant", () => {
    const meta = { ...META, item_multitool: { ...META.item_multitool, name: "Rifle Multi-Tool" } };
    expect(searchItems(STATE, meta, "rifle", "all").map((h) => h.nom)).toEqual(["Rifle Multi-Tool", "P4-AR Rifle"]);
  });
});

describe("highlight", () => {
  it("découpe le texte autour de la partie trouvée, accents compris", () => {
    expect(highlight("Aril Torse Armuré", "armure")).toEqual([
      { text: "Aril Torse ", hit: false },
      { text: "Armuré", hit: true },
    ]);
    expect(highlight("P4-AR", "")).toEqual([{ text: "P4-AR", hit: false }]);
  });
});

describe("pushRecent", () => {
  it("5 recherches au plus, la plus récente devant, sans doublon", () => {
    expect(pushRecent(["a1", "b2", "c3", "d4", "e5"], "f6")).toEqual(["f6", "a1", "b2", "c3", "d4"]);
    expect(pushRecent(["P4-AR", "medpen"], "p4-ar ")).toEqual(["p4-ar", "medpen"]);
    expect(pushRecent(["x1"], " ")).toEqual(["x1"]);
  });
});
