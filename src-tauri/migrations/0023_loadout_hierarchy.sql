-- Persiste la hiérarchie des slots dans les profils sauvegardés (Lot 1 #3).
-- Sans ces colonnes, un profil rechargé revenait à plat (depth absent) → l'arbre
-- des tourelles/racks s'effondrait après sauvegarde. hardpointId = identité du slot,
-- parentId = slot parent (réplique l'arbre de ShipHardpoint).
ALTER TABLE LoadoutSlot ADD COLUMN hardpointId INTEGER;
ALTER TABLE LoadoutSlot ADD COLUMN parentId INTEGER;
