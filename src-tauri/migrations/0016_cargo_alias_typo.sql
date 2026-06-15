-- Bloc 4 — Phase C' : alias pour le typo du flux de prix.
-- Le flux commodity-listings contient "sheperd's rest" (faute : 'h' manquant),
-- alors que la boutique / le lieu Wiki s'écrit "Shepherd's Rest".
--   slugify("sheperd's rest") = "sheperds-rest"   (côté prix)
--   slugify("Shepherd's Rest") = "shepherds-rest" (côté référentiel / Wiki)
-- On rattache explicitement le slug de prix au slug Wiki. Après ça, la sync prix
-- rattache 83/83 locations. (Aucun autre alias deviné.)
INSERT OR IGNORE INTO CargoLocationAlias (tradeSlug, wikiSlug, note)
VALUES ('sheperds-rest', 'shepherds-rest',
        'Typo du flux de prix commodity-listings ("sheperd''s rest") -> Shepherd''s Rest');
