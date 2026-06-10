CREATE TABLE IF NOT EXISTS CcuSku (
  skuId          INTEGER PRIMARY KEY NOT NULL,
  shipId         INTEGER NOT NULL,
  priceCents     INTEGER NOT NULL,
  available      INTEGER NOT NULL,
  unlimitedStock INTEGER NOT NULL,
  availableStock INTEGER,
  updatedAt      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_CcuSku_shipId ON CcuSku(shipId);

CREATE TABLE IF NOT EXISTS CcuUpgrade (
  fromShipId        INTEGER NOT NULL,
  toSkuId           INTEGER NOT NULL,
  upgradePriceCents INTEGER NOT NULL,
  updatedAt         TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (fromShipId, toSkuId),
  FOREIGN KEY (toSkuId) REFERENCES CcuSku(skuId) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_CcuUpgrade_fromShipId ON CcuUpgrade(fromShipId);
CREATE INDEX IF NOT EXISTS idx_CcuUpgrade_toSkuId    ON CcuUpgrade(toSkuId);

CREATE TABLE IF NOT EXISTS RsiShipName (
  shipId    INTEGER PRIMARY KEY NOT NULL,
  name      TEXT    NOT NULL,
  updatedAt TEXT    NOT NULL DEFAULT (datetime('now'))
);