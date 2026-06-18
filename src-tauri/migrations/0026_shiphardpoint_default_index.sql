-- Index pour la sous-requête "stock vaisseau" du picker (composant monté d'origine sur
-- quel(s) vaisseau(x)). Sans lui, scan de ShipHardpoint par ligne de composant.
CREATE INDEX IF NOT EXISTS idx_ShipHardpoint_default ON ShipHardpoint(defaultComponentClassName);
