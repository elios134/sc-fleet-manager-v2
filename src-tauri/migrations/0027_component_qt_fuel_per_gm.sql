-- Bloc 4 — Carburant quantique (GPS trading) : conso du quantum drive en SCU/Gm.
-- Source SC Wiki v2 : items?filter[type]=QuantumDrive → quantum_drive.fuel_consumption_scu_per_gm
-- (ex. 0.016 = 16 mSCU/Gm, valeur affichée par Erkul). Sert au coût carburant par leg.
-- Re-sync des composants nécessaire pour peupler la colonne.
ALTER TABLE Component ADD COLUMN qtFuelPerGm REAL;
