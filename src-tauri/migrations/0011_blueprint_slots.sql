-- Enrichissement des ingrédients de recette par EMPLACEMENT (aspect du DÉTAIL wiki).
-- slotName existe déjà (0007) ; on ajoute le libellé, le compte requis, le groupe de
-- sélection (alternatives), et les données du simulateur de qualité (min/bornes + modifiers).
-- SQLite : ADD COLUMN ne touche pas l'existant (valeurs NULL par défaut).
ALTER TABLE CraftingBlueprintIngredient ADD COLUMN slotLabel      TEXT;
ALTER TABLE CraftingBlueprintIngredient ADD COLUMN requiredCount  INTEGER;
ALTER TABLE CraftingBlueprintIngredient ADD COLUMN selectionGroup TEXT;
ALTER TABLE CraftingBlueprintIngredient ADD COLUMN minQuality     INTEGER;
ALTER TABLE CraftingBlueprintIngredient ADD COLUMN sliderMin      INTEGER;
ALTER TABLE CraftingBlueprintIngredient ADD COLUMN sliderMax      INTEGER;
ALTER TABLE CraftingBlueprintIngredient ADD COLUMN initialQuality INTEGER;
ALTER TABLE CraftingBlueprintIngredient ADD COLUMN modifiersJson  TEXT;
