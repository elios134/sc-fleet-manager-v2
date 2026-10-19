-- Liste de souhaits (vaisseaux RSI, ids de RsiShipName / CcuSku) + bascule de ses alertes.
CREATE TABLE IF NOT EXISTS WishlistShip (
  shipId  INTEGER PRIMARY KEY,
  addedAt TEXT NOT NULL
);
ALTER TABLE AppSettings ADD COLUMN notifWishlist INTEGER NOT NULL DEFAULT 1;
