-- V3 — État inventaire in-game (blob JSON cumulatif, reconstruit depuis le Game.log).
-- Une seule ligne (id=1) : l'état complet des possessions ; l'UI lit tout et filtre.
CREATE TABLE IF NOT EXISTS InventoryState (
  id        INTEGER PRIMARY KEY CHECK (id = 1),
  json      TEXT    NOT NULL,
  updatedAt TEXT    NOT NULL DEFAULT (datetime('now'))
);
