// Types partagés entre plusieurs onglets des réglages.

export type Account = {
  id: number;
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
};

export type NotifSettings = {
  insuranceExpiryThreshold: number;
  notifFleetStatus: boolean;
  notifMarketVolatility: boolean;
  notifSystemMessages: boolean;
  notifInApp: boolean;
  notifSystem: boolean;
  notifMinedMissions: boolean;
  notifInsuranceExpired: boolean;
  autoPatchDetect: boolean;
};

// Utilisés par l'onglet Données (état de sync) ET l'onglet Diagnostic.
export type CargoReferenceSyncReport = {
  commodities: number;
  shops: number;
  shipsApi: number;
  wikiLocations: number;
  positions: number;
  jumpConnections: number;
  mappingTotal: number;
  mappingMatched: number;
  mappingUnmatched: number;
  mappingViaAlias: number;
  positionsOk: boolean;
  positionsError: string | null;
  auditHubsMatched: number;
  auditHubsTotal: number;
  errors: string[];
};

export type UexSyncReport = {
  terminals: number;
  commodityTerminals: number;
  prices: number;
  terminalsMapped: number;
  terminalsUnmapped: number;
  hubsMatched: number;
  hubsTotal: number;
  errors: string[];
};
