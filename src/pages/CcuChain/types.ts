type CcuShip = {
  shipId: number;
  name: string;
  manufacturer: string | null;
  focus: string | null;
  imageUrl: string | null;
  priceCents: number | null;
  priceSource: "ccu" | "msrp" | null;
  isWarbondPrice: boolean;
  standardPriceCents: number | null;
  isOwned: boolean;
  isAvailable: boolean;
};

type Step = {
  fromShipId: number;
  toShipId: number;
  toSkuId: number;
  toSkuPriceCents: number;
  upgradePriceCents: number;
  isOwnedSourceShip: boolean;
};

type CcuPath = {
  steps: Step[];
  totalCostCents: number;
  stepCount: number;
  directCostCents: number | null;
  savingCents: number | null;
  warbondEndIndex: number | null;
};

type FindPathsResult = {
  paths: CcuPath[];
  totalFound: number;
  directCostCents: number | null;
  bestSavingCents: number | null;
  truncated: boolean;
};

type CatalogStatus = {
  hasSkus: boolean;
  hasUpgrades: boolean;
  lastSyncAt: string | null;
};

type Phase = "loading" | "empty" | "ready";

type WarbondTag = "warbond" | "standard" | "none";
export type { CcuShip, Step, CcuPath, FindPathsResult, CatalogStatus, Phase, WarbondTag };
