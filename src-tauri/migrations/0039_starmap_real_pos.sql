-- Coordonnées réelles (km, repère VerseTime / Wiki) des corps qui n'en ont pas dans la
-- géométrie de la carte (stations Wiki) : distances de l'itinéraire. NULL pour les corps RSI.
ALTER TABLE StarmapBody ADD COLUMN realX REAL;
ALTER TABLE StarmapBody ADD COLUMN realY REAL;
ALTER TABLE StarmapBody ADD COLUMN realZ REAL;
