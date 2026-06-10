CREATE TABLE IF NOT EXISTS Loadout (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  shipId      INTEGER NOT NULL,
  profileName TEXT    NOT NULL,
  createdAt   TEXT    NOT NULL DEFAULT (datetime('now')),
  updatedAt   TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (shipId) REFERENCES Ship(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_Loadout_shipId ON Loadout(shipId);

CREATE TABLE IF NOT EXISTS LoadoutSlot (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  loadoutId          INTEGER NOT NULL,
  slotType           TEXT    NOT NULL CHECK (slotType IN ('WEAPON','SHIELD','COOLER','POWER_PLANT','QUANTUM_DRIVE','MISSILE')),
  slotSize           INTEGER NOT NULL,
  componentName      TEXT,
  componentGrade     TEXT,
  componentMake      TEXT,
  portName           TEXT,
  componentClassName TEXT,
  FOREIGN KEY (loadoutId) REFERENCES Loadout(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_LoadoutSlot_loadoutId ON LoadoutSlot(loadoutId);

CREATE TABLE IF NOT EXISTS Component (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  wikiId                 TEXT    UNIQUE,
  className              TEXT    UNIQUE,
  name                   TEXT    NOT NULL,
  manufacturer           TEXT,
  type                   TEXT    NOT NULL CHECK (type IN ('WEAPON','SHIELD','COOLER','POWER_PLANT','QUANTUM_DRIVE','MISSILE')),
  size                   INTEGER NOT NULL,
  grade                  TEXT,
  class                  TEXT,
  dps                    REAL,
  shieldHp               REAL,
  powerDraw              REAL,
  heatGen                REAL,
  range                  REAL,
  alphaDamage            REAL,
  shieldRegenRate        REAL,
  shieldDelayDmg         REAL,
  shieldDelayDown        REAL,
  powerOutput            REAL,
  durabilityHealth       REAL,
  emMax                  REAL,
  irMax                  REAL,
  powerDrawMin           REAL,
  weaponFireRate         REAL,
  weaponProjectileSpeed  REAL,
  weaponSpreadMax        REAL,
  weaponAmmoCapacity     REAL,
  weaponAmmoRegen        REAL,
  weaponPenDistance      REAL,
  weaponOverheatShutdown REAL,
  shieldRegenTime        REAL,
  qtDriveSpeed           REAL,
  qtSpoolTime            REAL,
  qtCooldownTime         REAL,
  qtFuelRate             REAL,
  qtEfficiency           REAL,
  source                 TEXT    NOT NULL DEFAULT 'wiki',
  syncedAt               TEXT,
  scWikiType             TEXT,
  scWikiSubType          TEXT,
  scWikiRequiredTags     TEXT,
  lastSyncedAt           TEXT
);

CREATE TABLE IF NOT EXISTS MissileStats (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  componentId  INTEGER NOT NULL UNIQUE,
  damage       REAL,
  signalType   TEXT,
  armTime      REAL,
  lockTime     REAL,
  igniteTime   REAL,
  lockAngle    REAL,
  lockRangeMin REAL,
  lockRangeMax REAL,
  speed        REAL,
  FOREIGN KEY (componentId) REFERENCES Component(id) ON DELETE CASCADE
);