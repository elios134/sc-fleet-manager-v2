-- V3 — Registre des packs de traduction installés (un pack actif par canal SC).
-- Lu par le service de mise à jour en fond (qui n'a pas accès au localStorage du front).
CREATE TABLE IF NOT EXISTS TranslationInstall (
  channelPath     TEXT    PRIMARY KEY,
  packId          TEXT    NOT NULL,
  folder          TEXT    NOT NULL,
  url             TEXT    NOT NULL,
  etag            TEXT,
  lastModified    TEXT,
  updateAvailable INTEGER NOT NULL DEFAULT 0,
  installedAt     TEXT    NOT NULL DEFAULT (datetime('now')),
  checkedAt       TEXT
);
