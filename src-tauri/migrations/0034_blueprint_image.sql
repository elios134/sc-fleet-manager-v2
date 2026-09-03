-- Image de l'objet produit (SC Wiki images[0]) pour les vignettes du Crafting Hub.
-- Même source que Item.imageUrl (cf. 0033) : captée au sync détail (/items/{output_uuid}).
-- Nullable : certains matériaux craftés n'ont pas d'image Wiki (repli icône côté UI).
ALTER TABLE CraftingBlueprint ADD COLUMN imageUrl TEXT;
