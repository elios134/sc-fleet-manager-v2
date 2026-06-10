CREATE TABLE IF NOT EXISTS Scope (
  id          TEXT PRIMARY KEY NOT NULL,
  scopeName   TEXT NOT NULL UNIQUE,
  displayName TEXT NOT NULL,
  createdAt   TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS Rank (
  id            TEXT    PRIMARY KEY NOT NULL,
  scopeId       TEXT    NOT NULL,
  name          TEXT    NOT NULL,
  nameKey       TEXT    NOT NULL,
  minReputation INTEGER NOT NULL,
  rangeXP       INTEGER,
  rankIndex     INTEGER NOT NULL,
  FOREIGN KEY (scopeId) REFERENCES Scope(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_Rank_scopeId_rankIndex ON Rank(scopeId, rankIndex);
CREATE INDEX IF NOT EXISTS idx_Rank_scopeId ON Rank(scopeId);

CREATE TABLE IF NOT EXISTS Mission (
  uuid                    TEXT    PRIMARY KEY NOT NULL,
  source                  TEXT    NOT NULL DEFAULT 'wiki',
  title                   TEXT    NOT NULL,
  description             TEXT,
  missionGiver            TEXT,
  debugName               TEXT,
  factionName             TEXT,
  factionUuid             TEXT,
  factionType             TEXT,
  rewardScope             TEXT,
  illegal                 INTEGER NOT NULL DEFAULT 0,
  legalityLabel           TEXT,
  hasBlueprints           INTEGER NOT NULL DEFAULT 0,
  blueprintDropChance     REAL,
  rewardMin               INTEGER,
  rewardMax               INTEGER,
  rewardCurrency          TEXT,
  timeMins                INTEGER,
  shareable               INTEGER NOT NULL DEFAULT 0,
  maxPlayersPerInstance   INTEGER NOT NULL DEFAULT 1,
  maxInstancesPerPlayer   INTEGER NOT NULL DEFAULT 1,
  hasCombat               INTEGER NOT NULL DEFAULT 0,
  hasHauling              INTEGER NOT NULL DEFAULT 0,
  hasDefend               INTEGER NOT NULL DEFAULT 0,
  enemyCountMin           INTEGER,
  enemyCountMax           INTEGER,
  minStandingName         TEXT,
  minStandingValue        INTEGER,
  maxStandingName         TEXT,
  maxStandingValue        INTEGER,
  minCrimeStat            INTEGER,
  maxCrimeStat            INTEGER,
  availableInPrison       INTEGER NOT NULL DEFAULT 0,
  released                INTEGER NOT NULL DEFAULT 0,
  notForRelease           INTEGER NOT NULL DEFAULT 0,
  workInProgress          INTEGER NOT NULL DEFAULT 0,
  reacceptAfterAbandoning INTEGER DEFAULT 0,
  reacceptAfterFailing    INTEGER DEFAULT 0,
  starSystems             TEXT,
  reputationGained        TEXT,
  cooldownJson            TEXT,
  reputationAmount        INTEGER,
  rankIndex               INTEGER,
  gameVersion             TEXT,
  webUrl                  TEXT,
  lastSyncedAt            TEXT,
  scopeId                 TEXT,
  FOREIGN KEY (scopeId) REFERENCES Scope(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_Mission_released    ON Mission(released);
CREATE INDEX IF NOT EXISTS idx_Mission_factionUuid ON Mission(factionUuid);
CREATE INDEX IF NOT EXISTS idx_Mission_factionType ON Mission(factionType);
CREATE INDEX IF NOT EXISTS idx_Mission_rewardScope ON Mission(rewardScope);
CREATE INDEX IF NOT EXISTS idx_Mission_illegal     ON Mission(illegal);
CREATE INDEX IF NOT EXISTS idx_Mission_scopeId     ON Mission(scopeId);

CREATE TABLE IF NOT EXISTS MissionBlueprint (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  missionUuid TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  itemUuid    TEXT    NOT NULL,
  FOREIGN KEY (missionUuid) REFERENCES Mission(uuid) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_MissionBlueprint_missionUuid ON MissionBlueprint(missionUuid);
CREATE INDEX IF NOT EXISTS idx_MissionBlueprint_itemUuid    ON MissionBlueprint(itemUuid);

CREATE TABLE IF NOT EXISTS UserMissionObjective (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  accountId   TEXT    NOT NULL,
  missionUuid TEXT    NOT NULL,
  status      TEXT    NOT NULL,
  notes       TEXT,
  createdAt   TEXT    NOT NULL DEFAULT (datetime('now')),
  updatedAt   TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (accountId)   REFERENCES RsiAccount(id)  ON DELETE CASCADE,
  FOREIGN KEY (missionUuid) REFERENCES Mission(uuid)   ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_UserMissionObjective_accountId_status ON UserMissionObjective(accountId, status);
CREATE INDEX IF NOT EXISTS idx_UserMissionObjective_missionUuid      ON UserMissionObjective(missionUuid);

CREATE TABLE IF NOT EXISTS UserMissionFavorite (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  accountId   TEXT    NOT NULL,
  missionUuid TEXT    NOT NULL,
  note        TEXT,
  createdAt   TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (accountId)   REFERENCES RsiAccount(id) ON DELETE CASCADE,
  FOREIGN KEY (missionUuid) REFERENCES Mission(uuid)  ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_UserMissionFavorite_accountId_missionUuid ON UserMissionFavorite(accountId, missionUuid);
CREATE INDEX IF NOT EXISTS idx_UserMissionFavorite_accountId ON UserMissionFavorite(accountId);

CREATE TABLE IF NOT EXISTS UserScopeProgress (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  accountId         TEXT    NOT NULL,
  scopeId           TEXT    NOT NULL,
  currentReputation INTEGER NOT NULL,
  declaredAt        TEXT    NOT NULL DEFAULT (datetime('now')),
  updatedAt         TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (accountId) REFERENCES RsiAccount(id) ON DELETE CASCADE,
  FOREIGN KEY (scopeId)   REFERENCES Scope(id)      ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_UserScopeProgress_accountId_scopeId ON UserScopeProgress(accountId, scopeId);
CREATE INDEX IF NOT EXISTS idx_UserScopeProgress_accountId ON UserScopeProgress(accountId);
CREATE INDEX IF NOT EXISTS idx_UserScopeProgress_scopeId   ON UserScopeProgress(scopeId);