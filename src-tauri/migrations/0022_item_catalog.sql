-- Module Catalogue — items vendus in-game + vaisseaux (achat/location). 100 % ADDITIF,
-- lecture seule. Sources : UEX (public). Géolocalisation via UexTerminal (déjà en base).
-- Descriptif/stats NON ici (enrichissement Wiki lazy = lot 2).

-- Taxonomie UEX (filtre principal `section` → sous-filtre `name`).
CREATE TABLE IF NOT EXISTS ItemCategory (
  id            INTEGER PRIMARY KEY,   -- id_category UEX
  type          TEXT,                  -- 'item' | 'vehicle' | ...
  section       TEXT,                  -- filtre principal (Armor, Personal Weapons…)
  name          TEXT,                  -- sous-filtre (Helmets, Guns…)
  isGameRelated INTEGER,
  lastSyncedAt  TEXT
);

-- Catalogue des items VENDUS (≥1 point de vente). ~2785 lignes (pas les 12k Wiki).
CREATE TABLE IF NOT EXISTS Item (
  id           INTEGER PRIMARY KEY,    -- id_item UEX
  uuid         TEXT,
  name         TEXT,
  slug         TEXT,
  idCategory   INTEGER,
  section      TEXT,                   -- dénormalisé (filtre rapide)
  category     TEXT,                   -- sous-catégorie
  companyName  TEXT,                   -- fabricant
  size         TEXT,
  idVehicle    INTEGER,
  vehicleName  TEXT,
  urlStore     TEXT,
  lastSyncedAt TEXT
);
CREATE INDEX IF NOT EXISTS idx_Item_section  ON Item(section);
CREATE INDEX IF NOT EXISTS idx_Item_category ON Item(category);
CREATE INDEX IF NOT EXISTS idx_Item_uuid     ON Item(uuid);

-- Points de vente d'items (← /items_prices_all, price_buy>0). Join idTerminal → UexTerminal.
CREATE TABLE IF NOT EXISTS ItemPrice (
  id           INTEGER PRIMARY KEY,    -- id ligne UEX
  idItem       INTEGER,
  itemUuid     TEXT,
  itemName     TEXT,
  idCategory   INTEGER,
  idTerminal   INTEGER,
  terminalName TEXT,
  priceBuy     REAL,
  priceSell    REAL,
  dateModified INTEGER,
  lastSyncedAt TEXT
);
CREATE INDEX IF NOT EXISTS idx_ItemPrice_item     ON ItemPrice(idItem);
CREATE INDEX IF NOT EXISTS idx_ItemPrice_uuid     ON ItemPrice(itemUuid);
CREATE INDEX IF NOT EXISTS idx_ItemPrice_terminal ON ItemPrice(idTerminal);

-- Points d'ACHAT in-game (aUEC) des vaisseaux (← /vehicles_purchases_prices, hiérarchie inline).
CREATE TABLE IF NOT EXISTS VehiclePurchasePrice (
  id               INTEGER PRIMARY KEY,
  idVehicle        INTEGER,
  vehicleName      TEXT,
  idTerminal       INTEGER,
  terminalName     TEXT,
  priceBuy         REAL,               -- aUEC in-game
  starSystemName   TEXT,
  planetName       TEXT,
  orbitName        TEXT,
  moonName         TEXT,
  cityName         TEXT,
  outpostName      TEXT,
  spaceStationName TEXT,
  dateModified     INTEGER,
  lastSyncedAt     TEXT
);
CREATE INDEX IF NOT EXISTS idx_VehPurchase_vehicle ON VehiclePurchasePrice(idVehicle);

-- Points de LOCATION in-game (aUEC) des vaisseaux (← /vehicles_rentals_prices). Sans durée.
CREATE TABLE IF NOT EXISTS VehicleRentalPrice (
  id               INTEGER PRIMARY KEY,
  idVehicle        INTEGER,
  vehicleName      TEXT,
  idTerminal       INTEGER,
  terminalName     TEXT,
  priceRent        REAL,               -- aUEC in-game (durée non fournie par la source)
  starSystemName   TEXT,
  planetName       TEXT,
  orbitName        TEXT,
  moonName         TEXT,
  cityName         TEXT,
  outpostName      TEXT,
  spaceStationName TEXT,
  dateModified     INTEGER,
  lastSyncedAt     TEXT
);
CREATE INDEX IF NOT EXISTS idx_VehRental_vehicle ON VehicleRentalPrice(idVehicle);
