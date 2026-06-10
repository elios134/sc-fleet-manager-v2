CREATE TABLE IF NOT EXISTS AppSettings (
  id                      TEXT    PRIMARY KEY NOT NULL DEFAULT 'singleton',
  hudGlowIntensity        INTEGER NOT NULL DEFAULT 75,
  scanlineOpacity         INTEGER NOT NULL DEFAULT 60,
  gridVisibility          INTEGER NOT NULL DEFAULT 30,
  vignetteStrength        INTEGER NOT NULL DEFAULT 40,
  accentColor             TEXT    NOT NULL DEFAULT '#FFC56A',
  density                 TEXT    NOT NULL DEFAULT 'normal',
  animationsEnabled       INTEGER NOT NULL DEFAULT 1,
  soundsEnabled           INTEGER NOT NULL DEFAULT 0,
  highContrastMode        INTEGER NOT NULL DEFAULT 0,
  reduceMotion            INTEGER NOT NULL DEFAULT 0,
  animatedStarsBg         INTEGER NOT NULL DEFAULT 1,
  insuranceExpiryThreshold INTEGER NOT NULL DEFAULT 48,
  notifFleetStatus        INTEGER NOT NULL DEFAULT 1,
  notifMarketVolatility   INTEGER NOT NULL DEFAULT 1,
  notifSystemMessages     INTEGER NOT NULL DEFAULT 0,
  syncOnLaunch            INTEGER NOT NULL DEFAULT 1,
  rsiRefreshHours         INTEGER NOT NULL DEFAULT 0,
  autoPatchDetect         INTEGER NOT NULL DEFAULT 1,
  notifInApp              INTEGER NOT NULL DEFAULT 1,
  notifSystem             INTEGER NOT NULL DEFAULT 1,
  notifMinedMissions      INTEGER NOT NULL DEFAULT 1,
  notifInsuranceExpired   INTEGER NOT NULL DEFAULT 1,
  sidebarPosition         TEXT    NOT NULL DEFAULT 'left',
  sidebarCollapsedOnStart INTEGER NOT NULL DEFAULT 0,
  updatedAt               TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS Notification (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  accountId     TEXT    NOT NULL,
  type          TEXT    NOT NULL,
  title         TEXT    NOT NULL,
  body          TEXT    NOT NULL,
  relatedShipId INTEGER,
  firedAt       TEXT    NOT NULL DEFAULT (datetime('now')),
  readAt        TEXT,
  FOREIGN KEY (accountId)     REFERENCES RsiAccount(id) ON DELETE CASCADE,
  FOREIGN KEY (relatedShipId) REFERENCES Ship(id)       ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_Notification_accountId          ON Notification(accountId);
CREATE INDEX IF NOT EXISTS idx_Notification_accountId_readAt   ON Notification(accountId, readAt);
CREATE INDEX IF NOT EXISTS idx_Notification_type               ON Notification(type);
CREATE INDEX IF NOT EXISTS idx_Notification_firedAt            ON Notification(firedAt);

CREATE TABLE IF NOT EXISTS StarmapBody (
  id            TEXT    PRIMARY KEY NOT NULL,
  recordName    TEXT    NOT NULL UNIQUE,
  systemName    TEXT    NOT NULL,
  navIcon       TEXT    NOT NULL,
  name          TEXT    NOT NULL,
  description   TEXT,
  size          REAL,
  parentRef     TEXT,
  hideInStarmap INTEGER NOT NULL DEFAULT 0,
  showOrbitLine INTEGER NOT NULL DEFAULT 0,
  orbitOrder    INTEGER,
  source        TEXT    NOT NULL DEFAULT 'datamining',
  lastSyncedAt  TEXT,
  posX          REAL,
  posY          REAL,
  posZ          REAL
);

CREATE INDEX IF NOT EXISTS idx_StarmapBody_systemName ON StarmapBody(systemName);
CREATE INDEX IF NOT EXISTS idx_StarmapBody_navIcon    ON StarmapBody(navIcon);
CREATE INDEX IF NOT EXISTS idx_StarmapBody_parentRef  ON StarmapBody(parentRef);