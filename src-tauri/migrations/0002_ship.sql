CREATE TABLE IF NOT EXISTS ShipData (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  wikiId          TEXT    UNIQUE,
  wikiVersion     TEXT,
  classNameCig    TEXT    UNIQUE,
  rsiShipId       INTEGER,
  source          TEXT    NOT NULL DEFAULT 'wiki',
  syncedAt        TEXT,
  name            TEXT    NOT NULL,
  nameLocalized   TEXT,
  manufacturer    TEXT    NOT NULL,
  career          TEXT,
  role            TEXT    NOT NULL,
  classification  TEXT    NOT NULL DEFAULT '',
  focus           TEXT    NOT NULL DEFAULT '',
  size            TEXT,
  length          REAL,
  beam            REAL,
  height          REAL,
  maxSpeed        REAL,
  scmSpeed        REAL,
  shieldHp        REAL,
  hullHp          REAL,
  dpsMax          REAL,
  baseDps         REAL,
  pitchRate       REAL,
  yawRate         REAL,
  rollRate        REAL,
  cargoScu        INTEGER,
  quantumFuel     REAL,
  quantumRange    REAL,
  crewMin         INTEGER,
  crewMax         INTEGER,
  mass            REAL,
  priceUec        REAL,
  msrpUsd         INTEGER,
  imageUrl        TEXT,
  imageTopDownUrl TEXT,
  radarSpeed      REAL    NOT NULL DEFAULT 0,
  radarFirepower  REAL    NOT NULL DEFAULT 0,
  radarDefense    REAL    NOT NULL DEFAULT 0,
  radarRange      REAL    NOT NULL DEFAULT 0,
  radarAgility    REAL    NOT NULL DEFAULT 0,
  radarUtility    REAL    NOT NULL DEFAULT 0,
  emSignature     REAL,
  irSignature     REAL,
  crossSection    REAL,
  lastSyncedAt    TEXT
);

CREATE INDEX IF NOT EXISTS idx_ShipData_rsiShipId ON ShipData(rsiShipId);

CREATE TABLE IF NOT EXISTS ShipHardpoint (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  shipId                    INTEGER NOT NULL,
  portName                  TEXT    NOT NULL,
  displayName               TEXT    NOT NULL,
  type                      TEXT    NOT NULL,
  subType                   TEXT,
  minSize                   INTEGER NOT NULL,
  maxSize                   INTEGER NOT NULL,
  defaultComponentClassName TEXT,
  posX                      REAL    NOT NULL DEFAULT 0,
  posY                      REAL    NOT NULL DEFAULT 0,
  posZ                      REAL    NOT NULL DEFAULT 0,
  normalizedX               REAL    NOT NULL,
  normalizedY               REAL    NOT NULL,
  source                    TEXT    NOT NULL DEFAULT 'wiki',
  parentId                  INTEGER,
  FOREIGN KEY (shipId)   REFERENCES ShipData(id) ON DELETE CASCADE,
  FOREIGN KEY (parentId) REFERENCES ShipHardpoint(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ShipHardpoint_shipId   ON ShipHardpoint(shipId);
CREATE INDEX IF NOT EXISTS idx_ShipHardpoint_parentId ON ShipHardpoint(parentId);

CREATE TABLE IF NOT EXISTS Ship (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT    NOT NULL,
  manufacturer      TEXT    NOT NULL,
  role              TEXT    NOT NULL CHECK (role IN ('COMBAT','CARGO','MINING','EXPLORATION','MULTI','SUPPORT','RACING')),
  lti               INTEGER NOT NULL DEFAULT 0,
  insuranceExpiry   TEXT,
  insuranceDuration INTEGER,
  purchasePrice     REAL,
  notes             TEXT,
  importedFromRsi   INTEGER NOT NULL DEFAULT 0,
  rsiPledgeId       TEXT,
  rsiSyncedAt       TEXT,
  createdAt         TEXT    NOT NULL DEFAULT (datetime('now')),
  updatedAt         TEXT    NOT NULL DEFAULT (datetime('now')),
  accountId         TEXT    NOT NULL,
  FOREIGN KEY (accountId) REFERENCES RsiAccount(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_Ship_accountId ON Ship(accountId);

CREATE TABLE IF NOT EXISTS DataminingState (
  id                   INTEGER PRIMARY KEY DEFAULT 1,
  scInstallPath        TEXT,
  scChannel            TEXT,
  lastExtractedHash    TEXT,
  lastExtractedAt      TEXT,
  lastExtractedVersion TEXT,
  consentGiven         INTEGER NOT NULL DEFAULT 0,
  consentNeverAsk      INTEGER NOT NULL DEFAULT 0,
  enabled              INTEGER NOT NULL DEFAULT 1,
  starbreakerVersion   TEXT,
  patchNotifiedVersion TEXT
);