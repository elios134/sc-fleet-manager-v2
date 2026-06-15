-- Bloc 4 — Cargo & Routes, Phase A : cache des données de référence.
-- Sources GRATUITES (cf. mémoire bloc4-route-planner-apis) :
--   • SC Trade Tools (https://sc-trade.tools) : prix + catalogues (commodities, shops, ships).
--   • SC Wiki API (https://api.star-citizen.wiki) : lieux enrichis + positions x/y/z.
-- AUCUNE donnée de prix ni de calcul de route ici : uniquement le socle de référence.

/* ── 1. Marchandises (Trade Tools /api/commodity/items) ── */
CREATE TABLE IF NOT EXISTS CargoCommodity (
  name         TEXT PRIMARY KEY,
  lastSyncedAt TEXT
);

/* ── 2. Boutiques de commodités (Trade Tools /api/commodity/shops) ──
   name = chemin complet "Système > Planète > Station". On dérive `leaf`
   (dernier segment = station) et `system` (premier segment) pour le mapping. */
CREATE TABLE IF NOT EXISTS CargoShop (
  name         TEXT PRIMARY KEY,
  leaf         TEXT NOT NULL,
  systemName   TEXT,
  lastSyncedAt TEXT
);
CREATE INDEX IF NOT EXISTS idx_CargoShop_leaf ON CargoShop(leaf);

/* ── 3. Vaisseaux cargo de l'API (Trade Tools /api/ships) ──
   maxBoxSizeInScu = plus grosse boîte transportable (filtre de route). */
CREATE TABLE IF NOT EXISTS CargoShipApi (
  name            TEXT PRIMARY KEY,
  maxBoxSizeInScu INTEGER,
  lastSyncedAt    TEXT
);

/* ── 4. Lieux enrichis (SC Wiki /api/locations) ──
   uuid = clé stable, partagée avec WikiLocationPosition.uuid.
   slug = kebab-case du nom ; sert de pont vers les lieux Trade Tools. */
CREATE TABLE IF NOT EXISTS WikiStarmapLocation (
  uuid               TEXT PRIMARY KEY,
  slug               TEXT,
  name               TEXT,
  designation        TEXT,
  typeClassification TEXT,
  parentName         TEXT,
  parentSlug         TEXT,
  systemName         TEXT,
  lastSyncedAt       TEXT
);
CREATE INDEX IF NOT EXISTS idx_WikiStarmapLocation_slug ON WikiStarmapLocation(slug);
CREATE INDEX IF NOT EXISTS idx_WikiStarmapLocation_name ON WikiStarmapLocation(name);

/* ── 5a. Positions x/y/z (SC Wiki /api/locations/positions, NON DOCUMENTÉ) ──
   Coordonnées cartésiennes intra-système en mètres. Source isolée :
   si la sync échoue, cette table reste telle quelle (vide → fallback marge brute). */
CREATE TABLE IF NOT EXISTS WikiLocationPosition (
  uuid         TEXT PRIMARY KEY,
  name         TEXT,
  type         TEXT,
  systemName   TEXT,
  parentUuid   TEXT,
  x            REAL,
  y            REAL,
  z            REAL,
  qtValid      INTEGER NOT NULL DEFAULT 0,
  hidden       INTEGER NOT NULL DEFAULT 0,
  lastSyncedAt TEXT
);
CREATE INDEX IF NOT EXISTS idx_WikiLocationPosition_system ON WikiLocationPosition(systemName);

/* ── 5b. Sauts inter-systèmes (connections du même payload positions) ── */
CREATE TABLE IF NOT EXISTS WikiJumpConnection (
  entryUuid    TEXT NOT NULL,
  exitUuid     TEXT NOT NULL,
  entrySystem  TEXT,
  exitSystem   TEXT,
  fuelCost     REAL,
  lastSyncedAt TEXT,
  PRIMARY KEY (entryUuid, exitUuid)
);

/* ── 6a. Mapping lieu Trade Tools → SC Wiki ──
   Clé = tradeSlug (kebab-case du dernier segment d'un nom de boutique Trade Tools).
   C'est le pont prix ↔ positions : un lieu de prix se slugifie pareil et retombe ici.
   matchType : 'slug' (match direct), 'alias' (via CargoLocationAlias), 'none' (non résolu, à traiter). */
CREATE TABLE IF NOT EXISTS CargoLocationMapping (
  tradeSlug       TEXT PRIMARY KEY,
  tradeLeaf       TEXT NOT NULL,
  tradeExamplePath TEXT,
  wikiUuid        TEXT,
  wikiSlug        TEXT,
  wikiName        TEXT,
  wikiSystem      TEXT,
  matchType       TEXT NOT NULL DEFAULT 'none',
  lastSyncedAt    TEXT
);

/* ── 6b. Alias manuels (override du mapping pour les cas non résolus) ──
   Renseigné à la main quand un tradeSlug ne tombe pas pile sur un slug Wiki.
   On ne devine jamais : les cas 'none' sont logués pour décision. */
CREATE TABLE IF NOT EXISTS CargoLocationAlias (
  tradeSlug TEXT PRIMARY KEY,
  wikiSlug  TEXT NOT NULL,
  note      TEXT
);
