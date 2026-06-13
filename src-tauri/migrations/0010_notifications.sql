-- Historique des notifications (port du modèle Prisma V1 Notification).
-- Par compte (accountId TEXT = compte actif). FK non posée (convention V2 :
-- accountId TEXT, pas de cascade garantie).
CREATE TABLE IF NOT EXISTS Notification (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  accountId     TEXT    NOT NULL,
  type          TEXT    NOT NULL,
  title         TEXT    NOT NULL,
  body          TEXT    NOT NULL,
  relatedShipId INTEGER,
  firedAt       TEXT    NOT NULL DEFAULT (datetime('now')),
  readAt        TEXT
);

CREATE INDEX IF NOT EXISTS idx_notification_account ON Notification(accountId);
CREATE INDEX IF NOT EXISTS idx_notification_account_read ON Notification(accountId, readAt);
CREATE INDEX IF NOT EXISTS idx_notification_fired ON Notification(firedAt);
