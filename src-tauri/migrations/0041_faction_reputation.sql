-- Rang corrigé à la main par faction et par échelle (onglet Réputation). Sans ligne : rang déduit.
CREATE TABLE IF NOT EXISTS UserFactionReputation (
  accountId  TEXT NOT NULL,
  faction    TEXT NOT NULL,
  scopeId    TEXT NOT NULL,
  rankIndex  INTEGER NOT NULL,
  repInRank  INTEGER NOT NULL DEFAULT 0,
  declaredAt TEXT NOT NULL,
  PRIMARY KEY (accountId, faction, scopeId)
);
