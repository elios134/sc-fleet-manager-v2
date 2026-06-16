-- STARMAP Phase 1 — bascule de source datamining → données Wiki (en base).
-- StarmapBody est réutilisé tel quel. On ajoute wikiUuid pour cohabiter avec le
-- recordName « legacy » (stem datamining, ex. "stanton2") : recordName reste la
-- clé de couleur/image, wikiUuid porte l'uuid Wiki et sert de clé de jointure
-- parent↔enfant côté renderer. NULL pour les lignes issues du datamining.
ALTER TABLE StarmapBody ADD COLUMN wikiUuid TEXT;

CREATE INDEX IF NOT EXISTS idx_StarmapBody_wikiUuid ON StarmapBody(wikiUuid);
