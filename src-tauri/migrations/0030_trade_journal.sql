-- Phase 1.3 — Journal de commerce.
-- Transactions de cargo : saisies manuellement OU détectées depuis le Game.log
-- (source = 'manual' | 'gamelog'). Sert au P&L réel des trajets dans le Carnet de bord.
CREATE TABLE IF NOT EXISTS TradeJournal (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  accountId  TEXT,
  action     TEXT    NOT NULL,                    -- buy | sell
  commodity  TEXT    NOT NULL,
  scu        REAL,
  unitPrice  REAL,
  totalPrice REAL,
  location   TEXT,
  source     TEXT    NOT NULL DEFAULT 'manual',   -- manual | gamelog
  occurredAt TEXT,
  createdAt  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_TradeJournal_account  ON TradeJournal(accountId);
CREATE INDEX IF NOT EXISTS idx_TradeJournal_action   ON TradeJournal(action);
CREATE INDEX IF NOT EXISTS idx_TradeJournal_created  ON TradeJournal(createdAt);
