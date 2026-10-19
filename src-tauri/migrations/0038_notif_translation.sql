-- Notification « mise à jour de traduction disponible » (refonte Paramètres v3.2).
ALTER TABLE AppSettings ADD COLUMN notifTranslationUpdate INTEGER NOT NULL DEFAULT 1;
