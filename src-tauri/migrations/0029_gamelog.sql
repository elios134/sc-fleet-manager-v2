-- Phase 1 — Lecteur Game.log : événements de jeu reconstitués.
-- Le moteur (commands/gamelog.rs) tail le Game.log de l'install SC, parse chaque ligne
-- en événement typé et persiste ici. Le curseur d'offset et le lieu courant vivent dans
-- AppMeta (gamelog.offset / gamelog.path / gamelog.currentLocation / gamelog.enabled).
CREATE TABLE IF NOT EXISTS GameLogEvent (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  accountId  TEXT,
  kind       TEXT    NOT NULL,        -- location | death | vehicle | quantum | commodity_buy | commodity_sell | misc
  summary    TEXT    NOT NULL,        -- libellé lisible (FR-neutre, données du jeu)
  detail     TEXT,                    -- JSON des champs extraits (victim, killer, zone…)
  occurredAt TEXT,                    -- horodatage lu dans la ligne (ISO) si présent
  createdAt  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_GameLogEvent_kind      ON GameLogEvent(kind);
CREATE INDEX IF NOT EXISTS idx_GameLogEvent_createdAt ON GameLogEvent(createdAt);
CREATE INDEX IF NOT EXISTS idx_GameLogEvent_account   ON GameLogEvent(accountId);
