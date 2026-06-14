-- Métadonnées de l'objet produit, persistées pour l'en-tête de la fiche (R0) — afin d'éviter
-- les appels API live (/items) à chaque ouverture. Captées au sync (passe détail).
-- className réutilise producedItemEntityClass ; description réutilise producedItemDescription
-- (pas de duplication). Additif : l'existant reste valide (NULL par défaut).
ALTER TABLE CraftingBlueprint ADD COLUMN grade        TEXT;
ALTER TABLE CraftingBlueprint ADD COLUMN size         INTEGER;
ALTER TABLE CraftingBlueprint ADD COLUMN manufacturer TEXT;
ALTER TABLE CraftingBlueprint ADD COLUMN itemType     TEXT;
ALTER TABLE CraftingBlueprint ADD COLUMN subType      TEXT;
ALTER TABLE CraftingBlueprint ADD COLUMN webUrl       TEXT;
