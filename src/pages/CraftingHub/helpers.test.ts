import { describe, it, expect } from "vitest";
import {
  extractSizeTag,
  familyOf,
  fmtSignedPercent,
  formatCraftTime,
  groupIngredientsBySlot,
  matchTokens,
  modifierMultiplier,
  suggestBlueprint,
} from "./helpers";
import type { CraftIngredient, CraftingHubBlueprintItem } from "./types";

const ing = (order: number, over: Partial<CraftIngredient>) => ({ order, slotName: null, slotLabel: null, selectionGroup: null, requiredCount: null, ...over }) as CraftIngredient;
const bp = (id: string, displayName: string, producedItemName: string | null = null) =>
  ({ id, displayName, producedItemName }) as CraftingHubBlueprintItem;

describe("groupIngredientsBySlot", () => {
  it("un slot par ingrédient, les alternatives d'un même groupe réunies, ordre conservé", () => {
    const g = groupIngredientsBySlot([
      ing(2, { slotName: "FRAME", slotLabel: "Cadre", selectionGroup: "g1", requiredCount: 1 }),
      ing(1, { slotName: "BARREL" }),
      ing(3, { slotName: "FRAME", selectionGroup: "g1" }),
    ]);
    expect(g?.map((s) => [s.title, s.items.length])).toEqual([["BARREL", 1], ["Cadre", 2]]);
  });
  it("aucun slot réel → null (liste à plat)", () => {
    expect(groupIngredientsBySlot([ing(1, { slotName: "Recette" }), ing(2, {})])).toBeNull();
  });
});

describe("qualité et formats", () => {
  it("multiplicateur interpolé entre les deux bornes de qualité, borné", () => {
    const mod = { label: null, quality_range: { min: 0, max: 1000 }, modifier_range: { at_min_quality: 0.9, at_max_quality: 1.1 } };
    expect(modifierMultiplier(mod, 500)).toBeCloseTo(1.0);
    expect(modifierMultiplier(mod, 2000)).toBeCloseTo(1.1);
    expect(modifierMultiplier({ label: null }, 500)).toBe(1);
  });
  it("pourcentage signé (signe moins typographique)", () => {
    expect(fmtSignedPercent(1.125)).toBe("+12,5 %");
    expect(fmtSignedPercent(0.9)).toBe("−10 %");
    expect(fmtSignedPercent(1)).toBe("0 %");
  });
  it("durée de fabrication", () => {
    expect(formatCraftTime(null)).toBe("—");
    expect(formatCraftTime(0)).toBe("0s");
    expect(formatCraftTime(3725)).toBe("1h 2m 5s");
  });
  it("taille S1–S6 depuis la classe produite", () => {
    expect(extractSizeTag("POWR_ACOM_S2_Lumen")).toBe("S2");
    expect(extractSizeTag("powr_acom_s2_lumen")).toBe("S2");
    expect(extractSizeTag("klwe_laser_s3")).toBe("S3");
    expect(extractSizeTag(null)).toBeNull();
  });
});

describe("familyOf", () => {
  it("armures, armes FPS, armes vaisseau, objets de mission, composants par défaut", () => {
    expect(familyOf("Char_Armor_Helmet")).toBe("Armures FPS");
    expect(familyOf("WeaponPersonal")).toBe("Armes FPS");
    expect(familyOf("WeaponGun")).toBe("Armes vaisseau");
    expect(familyOf("MissionItem")).toBe("Objets mission");
    expect(familyOf("Cooler")).toBe("Composants vaisseau");
    expect(familyOf("")).toBe("Autres");
  });
});

describe("suggestBlueprint", () => {
  const items = [bp("a", "Aril Core", "Aril Torso"), bp("b", "Aril Arms"), bp("c", "Lumen Power Plant")];
  it("synonymes FR → EN et accents ignorés", () => {
    expect(matchTokens("Torse Aril")).toEqual(["core", "aril"]);
    expect(suggestBlueprint("Torse Aril", items)?.id).toBe("a");
    expect(suggestBlueprint("Brassards Aril", items)?.id).toBe("b");
  });
  it("sous le seuil de confiance → null", () => {
    expect(suggestBlueprint("Casque Zeus", items)).toBeNull();
    expect(suggestBlueprint("", items)).toBeNull();
  });
});
