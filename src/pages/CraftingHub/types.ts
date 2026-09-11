import { type BlueprintStat } from "../../lib/craftingStats";

/* ── Types (identiques à la V1) ── */

type CraftingHubBlueprintItem = {
  id: string;
  displayName: string;
  displayNameSource: "producedItem" | "name" | "recordName";
  category: string;
  categoryGroupKey: string;
  producedItemEntityClass: string;
  producedItemName: string | null;
  // Vignette de l'objet produit (SC Wiki images[0]) — null si absente (repli icône).
  imageUrl?: string | null;
  craftTimeSeconds: number | null;
  ingredientCount: number;
  ingredientPreview: string[];
  // Noms de TOUS les ingrédients (recherche par matériau). Absent sur ancien backend → [].
  ingredientNames?: string[];
};

type CraftingStats = {
  total: number;
  byCategory: Array<{ category: string; count: number }>;
};

type ItemDetails = {
  description: string | null;
  manufacturer: string | null;
  itemType: string | null;
  subType: string | null;
  size: number | null;
  grade: string | null;
  className: string | null;
} | null;

// Modifier d'un emplacement (du champ aspects.modifiers du wiki). La valeur du modifier est
// un MULTIPLICATEUR interpolé selon la qualité, entre at_min_quality (à quality_range.min)
// et at_max_quality (à quality_range.max). better_when indique le sens « bon ».
type CraftModifier = {
  label: string | null;
  property_key?: string | null;
  better_when?: string | null; // "higher" | "lower"
  quality_range?: { min: number | null; max: number | null } | null;
  modifier_range?: { at_min_quality: number | null; at_max_quality: number | null } | null;
  value_range_type?: string | null;
};

type BlueprintDetail = {
  blueprint: {
    id: string;
    displayName: string;
    displayNameSource: string;
    producedItemName: string | null;
    category: string | null;
    craftTimeSeconds: number | null;
    webUrl: string | null;
    imageUrl: string | null;
    descriptionData: Array<{ name: string; value: string }> | null;
    owned: boolean;
  };
  itemDetails: ItemDetails;
  ingredients: Array<{
    ingredientName: string;
    ingredientRef: string;
    ingredientType: string;
    ingredientTypeLabel: string;
    quantityLabel: string;
    order: number;
    slotName: string | null;
    slotLabel: string | null;
    requiredCount: number | null;
    selectionGroup: string | null;
    minQuality: number | null;
    sliderMin: number | null;
    sliderMax: number | null;
    initialQuality: number | null;
    modifiers: CraftModifier[] | null;
  }>;
  linkedMissions: Array<{
    missionUuid: string;
    title: string;
    factionName: string | null;
    starSystems: string | null;
    weight: number;
    navigable: boolean;
  }>;
  stats: BlueprintStat[];
};

// Recyclage (démantèlement) : temps + rendement + ressources rendues. null si indisponible.
// Récupéré PARESSEUSEMENT (commande dédiée) à l'ouverture de l'onglet Recyclage.
type Dismantle = {
  timeSeconds: number | null;
  timeLabel: string | null;
  efficiency: number | null;
  returns: Array<{
    name: string | null;
    resourceUuid: string | null;
    quantityScu: number | null;
    webUrl: string | null;
  }>;
} | null;

type CraftIngredient = BlueprintDetail["ingredients"][number];

// slotName = clé BRUTE (ex. « FRAME ») pour la qualité partagée et le match des stats
// (BlueprintStat.slotDebugName ?? slotName). title = libellé affiché (slotLabel sinon slotName).
type SlotGroup = {
  slotName: string;
  title: string;
  requiredCount: number | null;
  items: CraftIngredient[];
};

type OwnedFilter = "all" | "owned" | "remaining";

// Mode de recherche : par NOM de blueprint/objet produit, ou par INGRÉDIENT (matériau) de la recette.
type SearchMode = "name" | "ingredient";

/* ── Regroupement en familles FR (calque V1) ──
 * V1 groupe via BlueprintCategoryRecord ; en V2 on dérive la famille depuis output.type
 * (colonne `category`), à la volée côté front (pas de re-sync). Ordre V1 conservé. */
type Family =
  | "Armures FPS"
  | "Armes FPS"
  | "Composants vaisseau"
  | "Armes vaisseau"
  | "Objets mission"
  | "Autres";

// Carte d'info d'en-tête (Grade / Size / Class / Manufacturer) — label discret + valeur,
// « — » si absente (jamais de carte vide cassée).
type MiningLocation = {
  systemName: string;
  rawBodyKey: string;
  bodyName: string;
  miningMethod: string;
  rarity: string | null;
};
export type { CraftingHubBlueprintItem, CraftingStats, ItemDetails, CraftModifier, BlueprintDetail, Dismantle, CraftIngredient, SlotGroup, OwnedFilter, SearchMode, Family, MiningLocation };
