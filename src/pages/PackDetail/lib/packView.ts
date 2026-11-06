// Page d'un pack (logique pure, testée) : recherche, pastille d'assurance, conversion pour la fiche.
import type { ShipRow } from "../../Fleet";
import type { PackShip } from "../types";

/** Vaisseaux dont le nom ou le fabricant contient la recherche (sans casse). */
export function filterPackShips(ships: PackShip[], search: string): PackShip[] {
  const q = search.trim().toLowerCase();
  if (!q) return ships;
  return ships.filter((s) => s.shipName.toLowerCase().includes(q) || s.manufacturer.toLowerCase().includes(q));
}

export type PackInsuranceTone = "lti" | "short" | "unknown" | "ok";

/** Pastille d'assurance : LTI, courte (moins de 12 mois), inconnue, ou normale. */
export function packInsuranceTone(s: PackShip): PackInsuranceTone {
  if ((s.lti ?? 0) === 1) return "lti";
  if (s.insuranceDuration == null) return "unknown";
  return s.insuranceDuration < 12 ? "short" : "ok";
}

/** ShipRow (forme attendue par ShipDetailsModal) depuis un vaisseau du pack. */
export function toShipRow(s: PackShip): ShipRow {
  return {
    id: s.shipId!,
    name: s.shipName,
    manufacturer: s.manufacturer,
    role: s.role ?? "MULTI",
    lti: s.lti ?? 0,
    insuranceDuration: s.insuranceDuration,
    insuranceExpiry: s.insuranceExpiry,
    imageUrl: s.imageUrl,
    imageTopDownUrl: null,
    shipDataRole: null,
    shipDataManufacturer: null,
    shipDataClassification: null,
    shipDataFocus: null,
    shipDataSize: null,
    crewMin: null,
    crewMax: null,
    cargoScu: null,
    mass: null,
    length: null,
    beam: null,
    height: null,
    scmSpeed: null,
    maxSpeed: null,
    shieldHp: null,
    hullHp: null,
    baseDps: null,
    emSignature: null,
    irSignature: null,
    currentValueUsd: null,
    isUpgraded: null,
    isBuybackable: null,
    acquisition: "rsi",
    shipDataId: null,
    rentalExpiresAt: null,
    rentalDurationDays: null,
    packId: null,
    packName: null,
    packShipCount: null,
  };
}
