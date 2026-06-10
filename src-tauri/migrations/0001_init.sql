CREATE TABLE IF NOT EXISTS AppMeta (
  key   TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS RsiAccount (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  handle      TEXT    NOT NULL UNIQUE,
  displayName TEXT,
  avatarUrl   TEXT,
  createdAt   TEXT    NOT NULL DEFAULT (datetime('now')),
  updatedAt   TEXT    NOT NULL DEFAULT (datetime('now'))
);