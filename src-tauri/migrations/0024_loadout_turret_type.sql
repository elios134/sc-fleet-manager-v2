-- Autorise le type conteneur 'TURRET' dans LoadoutSlot.slotType (tourelles habitées
-- regroupant des gimbals/canons). SQLite ne permet pas d'altérer une contrainte CHECK :
-- on reconstruit la table en préservant les données et les colonnes hardpointId/parentId
-- ajoutées en 0023.
CREATE TABLE LoadoutSlot_new (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  loadoutId          INTEGER NOT NULL,
  slotType           TEXT    NOT NULL CHECK (slotType IN ('WEAPON','SHIELD','COOLER','POWER_PLANT','QUANTUM_DRIVE','MISSILE','TURRET')),
  slotSize           INTEGER NOT NULL,
  componentName      TEXT,
  componentGrade     TEXT,
  componentMake      TEXT,
  portName           TEXT,
  componentClassName TEXT,
  hardpointId        INTEGER,
  parentId           INTEGER,
  FOREIGN KEY (loadoutId) REFERENCES Loadout(id) ON DELETE CASCADE
);

INSERT INTO LoadoutSlot_new
  (id, loadoutId, slotType, slotSize, componentName, componentGrade, componentMake,
   portName, componentClassName, hardpointId, parentId)
SELECT
  id, loadoutId, slotType, slotSize, componentName, componentGrade, componentMake,
  portName, componentClassName, hardpointId, parentId
FROM LoadoutSlot;

DROP TABLE LoadoutSlot;
ALTER TABLE LoadoutSlot_new RENAME TO LoadoutSlot;

CREATE INDEX IF NOT EXISTS idx_LoadoutSlot_loadoutId ON LoadoutSlot(loadoutId);
