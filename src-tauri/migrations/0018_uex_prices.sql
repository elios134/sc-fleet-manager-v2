-- Bloc 4 — Bascule UEX : cache des prix + stock RÉELS (source primaire).
-- UEX (api.uexcorp.uk, lecture publique) raisonne du point de vue JOUEUR :
--   price_buy / scu_buy        = le joueur ACHÈTE ici (stock dispo à l'achat).
--   price_sell / scu_sell_stock = le joueur VEND ici (demande/inventaire de revente).
-- On garde CargoPriceListing (ancienne source SC Trade Tools) tant que non validé.

-- Référentiel terminaux UEX (823) : hiérarchie en clair + lien vers WikiStarmapLocation
-- (wikiUuid) pour les distances SC Wiki en repli.
CREATE TABLE IF NOT EXISTS UexTerminal (
  id               INTEGER PRIMARY KEY,   -- id_terminal UEX
  name             TEXT,
  nickname         TEXT,
  code             TEXT,
  type             TEXT,
  systemName       TEXT,
  planetName       TEXT,
  orbitName        TEXT,
  moonName         TEXT,
  spaceStationName TEXT,
  outpostName      TEXT,
  cityName         TEXT,
  idCity           INTEGER,
  idSpaceStation   INTEGER,
  displayName      TEXT,                  -- meilleur nom lisible
  wikiUuid         TEXT,                  -- résolu contre WikiStarmapLocation (distance repli)
  wikiSlug         TEXT,
  lastSyncedAt     TEXT
);
CREATE INDEX IF NOT EXISTS idx_UexTerminal_wikiUuid ON UexTerminal(wikiUuid);

-- Prix par terminal × commodity (depuis /commodities_prices_all, 1 appel).
CREATE TABLE IF NOT EXISTS UexCommodityPrice (
  id                INTEGER PRIMARY KEY,  -- id ligne UEX
  idCommodity       INTEGER,
  commodityName     TEXT,
  idTerminal        INTEGER,
  priceBuy          REAL,
  priceBuyAvg       REAL,
  scuBuy            REAL,
  scuBuyAvg         REAL,
  priceSell         REAL,
  priceSellAvg      REAL,
  scuSellStock      REAL,
  scuSellStockAvg   REAL,
  statusBuy         INTEGER,
  statusSell        INTEGER,
  dateModified      INTEGER,
  timestampIso      TEXT,                 -- ISO dérivé de dateModified (fraîcheur)
  lastSyncedAt      TEXT
);
CREATE INDEX IF NOT EXISTS idx_UexPrice_commodity ON UexCommodityPrice(commodityName);
CREATE INDEX IF NOT EXISTS idx_UexPrice_terminal  ON UexCommodityPrice(idTerminal);
