-- STARMAP Sous-projet A — bascule de source vers l'API RSI Starmap.
-- Colonnes natives polaires + visuelles. Toutes nullable (rétro-compatibles).
-- posX/Y/Z (déjà présentes) sont recalculées par le sync RSI depuis distance/longitude/latitude.
ALTER TABLE StarmapBody ADD COLUMN distance   REAL;
ALTER TABLE StarmapBody ADD COLUMN longitude  REAL;
ALTER TABLE StarmapBody ADD COLUMN latitude   REAL;
ALTER TABLE StarmapBody ADD COLUMN subtype    TEXT;
ALTER TABLE StarmapBody ADD COLUMN appearance TEXT;
ALTER TABLE StarmapBody ADD COLUMN habitable  INTEGER;
ALTER TABLE StarmapBody ADD COLUMN affColor   TEXT;
