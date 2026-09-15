export type ShipRow = {
  id: number;
  name: string;
  manufacturer: string;
  role: string;
  lti: number;
  insuranceDuration: number | null;
  insuranceExpiry: string | null;
  imageUrl: string | null;
  imageTopDownUrl: string | null;
  shipDataRole: string | null;
  shipDataManufacturer: string | null;
  shipDataClassification: string | null;
  shipDataFocus: string | null;
  shipDataSize: string | null;
  crewMin: number | null;
  crewMax: number | null;
  cargoScu: number | null;
  mass: number | null;
  length: number | null;
  beam: number | null;
  height: number | null;
  scmSpeed: number | null;
  maxSpeed: number | null;
  shieldHp: number | null;
  hullHp: number | null;
  baseDps: number | null;
  emSignature: number | null;
  irSignature: number | null;
  currentValueUsd: number | null;
  isUpgraded: number | null;
  isBuybackable: number | null;
  // Acquisition (migration 0020) : origine + location.
  acquisition: string;
  shipDataId: number | null;
  rentalExpiresAt: string | null;
  rentalDurationDays: number | null;
};

export type FleetStats = {
  totalFleetValueUsd: number;
  shipsOwnedCount: number;
  ltiAssetsCount: number;
  nextExpiry: { shipName: string; daysRemaining: number } | null;
};

export type ShipView = "grid" | "list";
export type FleetFilter = "ALL" | "LTI" | import("../../lib/shipCategory").RsiCategory;
export type SortKey = "value" | "name" | "ins";

export type CatalogShip = {
  id: number;
  name: string;
  manufacturer: string;
  imageUrl: string | null;
  classification: string | null;
};
