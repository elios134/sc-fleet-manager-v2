-- « Description Data » de l'objet produit (liste {name, value} déjà formatée par l'API
-- /items, variable selon le type d'objet). Captée au sync depuis l'appel /items déjà fait
-- (R0) — aucun appel supplémentaire. Stockée en JSON brut. Additive (NULL par défaut).
ALTER TABLE CraftingBlueprint ADD COLUMN descriptionDataJson TEXT;
