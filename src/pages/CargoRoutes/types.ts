import { type TFunction } from "i18next";

type FleetShip = {
  name: string;
  manufacturer: string | null;
  cargoScu: number | null;
  role: string | null;
  qtDefault?: boolean; // présent pour le catalogue (groupe « tous cargo »)
};

type ShipGroup = "fleet" | "all";
// Identité minimale d'une route transmise par le widget dashboard pour pré-ouverture.

type PendingRoute = {
  shipName: string;
  commodity: string;
  fromLocation: string;
  toLocation: string;
};

export type CargoRoute = {
  commodity: string;
  fromLocation: string;
  toLocation: string;
  fromName: string | null;
  toName: string | null;
  fromUuid: string | null;
  toUuid: string | null;
  buyPrice: number;
  sellPrice: number;
  marginUnit: number;
  quantityScu: number;
  profit: number;
  fromSystem: string | null;
  toSystem: string | null;
  jumps: number | null;
  distanceGm: number | null;
  timeMinutes: number | null;
  profitPerMinute: number | null;
  priceTimestamp: string | null;
  fuel: number | null;
  // Carburant quantique consommé par ce leg (SCU) = distanceGm × conso drive. null si non synchro.
  fuelScu: number | null;
};

type FindRoutesResult = {
  shipName: string;
  cargoScu: number | null;
  qtResolved: boolean;
  investment: number;
  routesConsidered: number;
  routesWithTime: number;
  routes: CargoRoute[];
  note: string;
};

type LoopResult = {
  legs: CargoRoute[];
  totalProfit: number;
  totalTimeMinutes: number | null;
  hops: number;
  closed: boolean;
  startLocation: string;
  endLocation: string;
  note: string | null;
};

type PricesStatus = {
  rows: number;
  terminals: number;
  terminalsMapped: number;
  freshestTimestamp: string | null;
  sellPointsWithDemand: number;
};

/* ── Types GPS trading (miroir TradeGraph Rust) ── */

export type Affluence = "low" | "medium" | "high";

export type GpsLeg = CargoRoute & { fromKey: string; toKey: string; affluence: Affluence };

/* ── Overlay en jeu : la route choisie (quel que soit l'outil) est poussée vers la
   fenêtre overlay via AppMeta « overlay.nav » + l'event « overlay:nav ». L'overlay
   l'affiche étape par étape et surligne l'étape courante selon le lieu détecté. ── */

type OverlayStep = {
  from: string;
  to: string;
  commodity?: string;
  profit?: number;
  scu?: number;
  minutes?: number;
  jumps?: number;
  fuel?: number; // SCU de carburant quantique du leg
  distanceGm?: number; // distance du leg (Gm) → alerte ravitaillement cumulée
};

type OverlayRoute =
  | {
      source: "single" | "loop" | "gps" | "cart";
      shipName?: string;
      rangeGm?: number | null; // autonomie quantique (Gm) → calcul du ravitaillement
      steps: OverlayStep[];
    }
  | null;

type GpsBuyItem = {
  commodity: string;
  buyPrice: number;
  stock: number | null;
  statusBuy: number | null;
  outOfStock: boolean;
};

type GpsLocation = { key: string; name: string; system: string | null };

export type GpsPos = { x: number; y: number; z: number; system: string | null };

export type TradeGraph = {
  shipName: string;
  cargoScu: number | null;
  qtResolved: boolean;
  // Autonomie quantique max (Gm) et capacité réservoir (SCU). null si non synchronisées.
  quantumRangeGm: number | null;
  quantumFuelScu: number | null;
  legsFrom: Record<string, GpsLeg[]>;
  buyableAt: Record<string, GpsBuyItem[]>;
  positions: Record<string, GpsPos>;
  locations: GpsLocation[];
};
// Une étape confirmée du trajet GPS (leg = CargoRoute → modale + soute compatibles).

export type GpsStep = { leg: GpsLeg };

type RouteSort = "profit" | "ppm" | "time";

type CargoCtx = {
  t: TFunction;
  ships: FleetShip[];
  group: ShipGroup;
  switchGroup: (g: ShipGroup) => void;
  fleetCount: number;
  catalogCount: number;
  shipName: string;
  setShipName: (v: string) => void;
  selectedShip: FleetShip | null;
  budget: string;
  setBudget: (v: string) => void;
  system: string;
  setSystem: (v: string) => void;
  prices: PricesStatus | null;
};

// Convoi actif : l'état qui relie Trouver → Charger → Naviguer → Vendre.

type ActiveConvoy = { route: CargoRoute; leg: number; shipName: string; cargoScu: number };

// ── Barre de contexte : les 3 « slots » partagés, toujours visibles ──

export type LoadToHoldRequest = { shipName: string; commodity: string; scu: number; nonce: number };
export type { FleetShip, ShipGroup, PendingRoute, FindRoutesResult, LoopResult, PricesStatus, OverlayStep, OverlayRoute, GpsBuyItem, GpsLocation, RouteSort, CargoCtx, ActiveConvoy };
