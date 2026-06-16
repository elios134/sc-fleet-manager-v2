-- Acquisition vaisseaux : distingue l'origine d'un Ship et gère la location.
-- acquisition : 'rsi' (hangar synchronisé, défaut) | 'bought' (acheté in-game) | 'rented' (loué).
-- shipDataId  : lien explicite au catalogue ShipData (fiabilise la jointure par nom).
-- rentalExpiresAt / rentalDurationDays : location uniquement (NULL sinon).
-- Pas de colonne « status » : l'état (actif/expiré) est calculé (rentalExpiresAt < now).

ALTER TABLE Ship ADD COLUMN acquisition        TEXT    NOT NULL DEFAULT 'rsi';
ALTER TABLE Ship ADD COLUMN shipDataId         INTEGER;
ALTER TABLE Ship ADD COLUMN rentalExpiresAt    TEXT;
ALTER TABLE Ship ADD COLUMN rentalDurationDays INTEGER;

CREATE INDEX IF NOT EXISTS idx_Ship_acquisition ON Ship(acquisition);
