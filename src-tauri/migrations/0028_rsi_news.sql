-- Phase 0 — Cache des actualités RSI (flux comm-link).
-- Permet l'affichage hors-ligne et limite les appels réseau (TTL géré côté Rust via
-- AppMeta 'news.lastFetchedAt'). `position` conserve l'ordre anté-chronologique du flux.
CREATE TABLE IF NOT EXISTS RsiNews (
  guid      TEXT    PRIMARY KEY NOT NULL,
  title     TEXT    NOT NULL,
  link      TEXT    NOT NULL,
  pubDate   TEXT,
  category  TEXT,
  summary   TEXT,
  position  INTEGER NOT NULL DEFAULT 0,
  fetchedAt TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_RsiNews_position ON RsiNews(position);
