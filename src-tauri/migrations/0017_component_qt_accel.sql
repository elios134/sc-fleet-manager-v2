-- Bloc 4 — Phase C' : taux d'accélération du Quantum Drive pour le modèle de temps
-- réaliste (rampe accel → vmax → décel, façon SC Wiki routePlanner.js).
-- Champs disponibles via la sync composants existante
-- (/api/v2/items → quantum_drive.standard_jump.stage_one/two_accel_rate,
--  quantum_drive.travel_time_10gm.seconds). Re-sync composants nécessaire pour peupler.
ALTER TABLE Component ADD COLUMN qtAccelStageOne  REAL;
ALTER TABLE Component ADD COLUMN qtAccelStageTwo  REAL;
ALTER TABLE Component ADD COLUMN qtTravelTime10gm REAL;
