// Logique pure de slots/hardpoints du loadout (extraite de LoadoutPage pour être testée).

/** Nom de port lisible : "hardpoint_weapon_left" → "WEAPON LEFT". */
export function humanizePortName(portName: string): string {
  return portName.replace(/^hardpoint_/i, "").replace(/_/g, " ").toUpperCase();
}

/** Mappe un type de hardpoint brut vers un slotType canonique (CHECK LoadoutSlot).
    null si non géré. ⚠️ l'ordre compte : TURRET (conteneur) AVANT la règle WEAPON. */
export function mapHardpointType(raw: string): string | null {
  const t = raw.toUpperCase();
  if (t === "TURRET") return "TURRET";
  if (t.includes("MISSILE") || t.includes("ROCKET")) return "MISSILE";
  if (t.includes("WEAPON") || t.includes("GUN") || t.includes("TURRET") || t.includes("CANNON"))
    return "WEAPON";
  if (t.includes("SHIELD")) return "SHIELD";
  if (t.includes("POWER")) return "POWER_PLANT";
  if (t.includes("QUANTUM") || t.includes("QDRIVE")) return "QUANTUM_DRIVE";
  if (t.includes("COOL")) return "COOLER";
  return null;
}
