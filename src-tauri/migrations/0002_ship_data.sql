CREATE TABLE IF NOT EXISTS AppMeta (
  key   TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS RsiAccount (
  id                    TEXT    PRIMARY KEY NOT NULL,
  handle                TEXT    NOT NULL UNIQUE,
  displayName           TEXT,
  portraitUrl           TEXT,
  rank                  TEXT,
  email                 TEXT,
  currency              TEXT,
  createdAt             TEXT    NOT NULL DEFAULT (datetime('now')),
  lastSyncedAt          TEXT,
  conciergeLevel        TEXT,
  conciergeProgress     REAL,
  conciergeLastSyncedAt TEXT,
  conciergeNullRuns     INTEGER NOT NULL DEFAULT 0
);