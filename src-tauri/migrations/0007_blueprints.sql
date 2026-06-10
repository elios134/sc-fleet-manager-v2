CREATE TABLE IF NOT EXISTS CraftingBlueprint (
  id                      TEXT PRIMARY KEY NOT NULL,
  recordName              TEXT NOT NULL UNIQUE,
  name                    TEXT,
  producedItemEntityClass TEXT NOT NULL,
  producedItemName        TEXT,
  producedItemNameFr      TEXT,
  producedItemDescription TEXT,
  producedItemStatsJson   TEXT,
  category                TEXT NOT NULL,
  craftTimeSeconds        INTEGER,
  source                  TEXT NOT NULL DEFAULT 'datamining',
  lastSyncedAt            TEXT
);

CREATE INDEX IF NOT EXISTS idx_CraftingBlueprint_category               ON CraftingBlueprint(category);
CREATE INDEX IF NOT EXISTS idx_CraftingBlueprint_producedItemEntityClass ON CraftingBlueprint(producedItemEntityClass);

CREATE TABLE IF NOT EXISTS CraftingBlueprintIngredient (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  blueprintId    TEXT    NOT NULL,
  slotName       TEXT    NOT NULL,
  ingredientType TEXT    NOT NULL,
  ingredientRef  TEXT    NOT NULL,
  ingredientName TEXT,
  quantity       REAL    NOT NULL,
  "order"        INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (blueprintId) REFERENCES CraftingBlueprint(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_CraftingBlueprintIngredient_blueprintId                   ON CraftingBlueprintIngredient(blueprintId);
CREATE INDEX IF NOT EXISTS idx_CraftingBlueprintIngredient_ingredientType_ingredientRef  ON CraftingBlueprintIngredient(ingredientType, ingredientRef);

CREATE TABLE IF NOT EXISTS UserCraftingBlueprintOwned (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  accountId   TEXT    NOT NULL,
  blueprintId TEXT    NOT NULL,
  note        TEXT,
  createdAt   TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (accountId)   REFERENCES RsiAccount(id)        ON DELETE CASCADE,
  FOREIGN KEY (blueprintId) REFERENCES CraftingBlueprint(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_UserCraftingBlueprintOwned_accountId_blueprintId ON UserCraftingBlueprintOwned(accountId, blueprintId);
CREATE INDEX IF NOT EXISTS idx_UserCraftingBlueprintOwned_accountId ON UserCraftingBlueprintOwned(accountId);

CREATE TABLE IF NOT EXISTS MissionBlueprintReward (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  missionUuid TEXT    NOT NULL,
  blueprintId TEXT    NOT NULL,
  weight      REAL    NOT NULL,
  poolRef     TEXT,
  FOREIGN KEY (missionUuid) REFERENCES Mission(uuid)              ON DELETE CASCADE,
  FOREIGN KEY (blueprintId) REFERENCES CraftingBlueprint(id)      ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_MissionBlueprintReward_missionUuid_blueprintId ON MissionBlueprintReward(missionUuid, blueprintId);
CREATE INDEX IF NOT EXISTS idx_MissionBlueprintReward_missionUuid ON MissionBlueprintReward(missionUuid);
CREATE INDEX IF NOT EXISTS idx_MissionBlueprintReward_blueprintId ON MissionBlueprintReward(blueprintId);

CREATE TABLE IF NOT EXISTS ResourceMiningLocation (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  resourceStem TEXT    NOT NULL,
  resourceRef  TEXT    NOT NULL,
  systemName   TEXT    NOT NULL,
  rawBodyKey   TEXT    NOT NULL,
  bodyName     TEXT,
  miningMethod TEXT    NOT NULL,
  rarity       TEXT,
  source       TEXT    NOT NULL DEFAULT 'datamining',
  lastSyncedAt TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ResourceMiningLocation_stem_body_method ON ResourceMiningLocation(resourceStem, rawBodyKey, miningMethod);
CREATE INDEX IF NOT EXISTS idx_ResourceMiningLocation_resourceStem ON ResourceMiningLocation(resourceStem);
CREATE INDEX IF NOT EXISTS idx_ResourceMiningLocation_rawBodyKey   ON ResourceMiningLocation(rawBodyKey);