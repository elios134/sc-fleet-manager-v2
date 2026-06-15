-- Bloc 4 — Cargo & Routes, Phase B' : cache des PRIX (crowdsource commodity-listings).
-- Source GRATUITE : GET /api/crowdsource/commodity-listings (SC Trade Tools, 200 sans token).
-- Flux brut newest-first, paginé. On NE garde QUE la ligne la plus fraîche par triplet
-- fonctionnel (location, commodity, transaction).
--   transaction = "SELLS" → la boutique VEND   (point d'ACHAT joueur, prix bas recherché)
--   transaction = "BUYS"  → la boutique ACHÈTE (point de REVENTE joueur, prix haut recherché)
-- Pas de calcul de route ici : uniquement le cache des prix.

CREATE TABLE IF NOT EXISTS CargoPriceListing (
  location      TEXT NOT NULL,           -- chaîne Trade Tools ("système > planète > station" ou leaf nu)
  commodity     TEXT NOT NULL,
  "transaction" TEXT NOT NULL,           -- "BUYS" | "SELLS"
  price         REAL,
  quantity      INTEGER,
  saturation    REAL,
  timestamp     TEXT,                    -- fraîcheur de la ligne (ISO, source)
  batchId       TEXT,
  locationSlug  TEXT,                    -- slugify(leaf(location)) → pont vers CargoLocationMapping.tradeSlug
  syncedAt      TEXT,
  PRIMARY KEY (location, commodity, "transaction")
);

CREATE INDEX IF NOT EXISTS idx_CargoPriceListing_slug      ON CargoPriceListing(locationSlug);
CREATE INDEX IF NOT EXISTS idx_CargoPriceListing_commodity ON CargoPriceListing(commodity);
CREATE INDEX IF NOT EXISTS idx_CargoPriceListing_tx        ON CargoPriceListing("transaction");
