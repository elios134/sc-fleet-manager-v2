-- Origine d'une entrée du catalogue CCU : 'online' (index partagé ccu-data, dispo pour
-- tous les users, MAJ hebdo) ou 'account' (scrape RSI perso, enrichissement optionnel).
-- Permet de distinguer/merger les deux sources ; défaut 'account' = données pré-existantes.
ALTER TABLE CcuSku ADD COLUMN source TEXT NOT NULL DEFAULT 'account';
ALTER TABLE CcuUpgrade ADD COLUMN source TEXT NOT NULL DEFAULT 'account';
