CREATE TABLE IF NOT EXISTS Pledge (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  rsiPledgeId     TEXT    NOT NULL,
  accountId       TEXT    NOT NULL,
  name            TEXT    NOT NULL,
  type            TEXT    NOT NULL,
  currentValueUsd REAL,
  currency        TEXT,
  isUpgraded      INTEGER NOT NULL DEFAULT 0,
  isBuybackable   INTEGER NOT NULL DEFAULT 0,
  createdDate     TEXT,
  lti             INTEGER,
  insuranceMonths INTEGER,
  createdAt       TEXT    NOT NULL DEFAULT (datetime('now')),
  updatedAt       TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (accountId) REFERENCES RsiAccount(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_Pledge_accountId_rsiPledgeId ON Pledge(accountId, rsiPledgeId);
CREATE INDEX IF NOT EXISTS idx_Pledge_accountId ON Pledge(accountId);

CREATE TABLE IF NOT EXISTS PledgeShip (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  pledgeId         INTEGER NOT NULL,
  shipName         TEXT    NOT NULL,
  manufacturer     TEXT    NOT NULL,
  manufacturerCode TEXT,
  imageUrl         TEXT,
  membershipId     TEXT,
  customName       TEXT,
  isNameable       INTEGER NOT NULL DEFAULT 0,
  shipId           INTEGER,
  createdAt        TEXT    NOT NULL DEFAULT (datetime('now')),
  updatedAt        TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (pledgeId) REFERENCES Pledge(id) ON DELETE CASCADE,
  FOREIGN KEY (shipId)   REFERENCES Ship(id)   ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_PledgeShip_pledgeId_shipName ON PledgeShip(pledgeId, shipName);
CREATE INDEX IF NOT EXISTS idx_PledgeShip_pledgeId ON PledgeShip(pledgeId);
CREATE INDEX IF NOT EXISTS idx_PledgeShip_shipId   ON PledgeShip(shipId);

CREATE TABLE IF NOT EXISTS PledgeUpgradeLog (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  pledgeId       INTEGER NOT NULL,
  appliedAt      TEXT    NOT NULL,
  ccuId          TEXT,
  fromShipName   TEXT    NOT NULL,
  toShipName     TEXT    NOT NULL,
  newPledgeValue REAL,
  createdAt      TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (pledgeId) REFERENCES Pledge(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_PledgeUpgradeLog_pledgeId ON PledgeUpgradeLog(pledgeId);

CREATE TABLE IF NOT EXISTS HangarItem (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  pledgeId     INTEGER NOT NULL,
  accountId    TEXT    NOT NULL,
  title        TEXT    NOT NULL,
  kind         TEXT,
  imageUrl     TEXT,
  manufacturer TEXT,
  createdAt    TEXT    NOT NULL DEFAULT (datetime('now')),
  updatedAt    TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (pledgeId)   REFERENCES Pledge(id)     ON DELETE CASCADE,
  FOREIGN KEY (accountId)  REFERENCES RsiAccount(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_HangarItem_pledgeId_title ON HangarItem(pledgeId, title);
CREATE INDEX IF NOT EXISTS idx_HangarItem_accountId ON HangarItem(accountId);