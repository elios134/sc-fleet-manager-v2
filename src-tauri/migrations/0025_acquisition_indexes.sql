-- Index pour les sous-requêtes d'acquisition du picker de loadout (achetable/craftable).
-- Sans eux, get_components_for_slot scanne ItemPrice (23k) et CraftingBlueprint par ligne
-- → ~950 ms ; avec → ~3 ms. L'index sur LOWER(producedItemEntityClass) matche la jointure
-- insensible à la casse (blueprints en minuscules vs Component.className).
CREATE INDEX IF NOT EXISTS idx_ItemPrice_itemUuid ON ItemPrice(itemUuid);
CREATE INDEX IF NOT EXISTS idx_ItemPrice_itemName ON ItemPrice(itemName);
CREATE INDEX IF NOT EXISTS idx_CraftingBlueprint_producedName ON CraftingBlueprint(producedItemName);
CREATE INDEX IF NOT EXISTS idx_CraftingBlueprint_producedClassLower ON CraftingBlueprint(LOWER(producedItemEntityClass));
CREATE INDEX IF NOT EXISTS idx_CraftingBlueprintIngredient_blueprintId ON CraftingBlueprintIngredient(blueprintId);
