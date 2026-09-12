// Types de la page Minage (work order : brut → raffinage → vente).

/** Une ligne de brut saisie : minéral (clé registre) + quantité SCU. */
export type OreLine = { key: string; scu: number };

/** Meilleur point de vente d'un minéral raffiné (UEX live, ou repli hors-ligne). */
export type SellPoint = {
  mineral: string; // clé registre
  terminal: string;
  system: string;
  priceSell: number; // aUEC / SCU
  scuDemand: number; // stock de demande (scuSellStock)
  updatedAt: string | null; // ISO — fraîcheur du prix
  live: boolean; // true = UEX, false = repli statique
};

/** Résultat d'évaluation d'une méthode de raffinage sur le brut saisi. */
export type MethodResult = {
  key: string;
  name: string;
  refinedScu: number; // total raffiné (Σ scu × yield)
  revenue: number; // aUEC (raffiné × prix de vente)
  cost: number; // aUEC (coût de raffinage estimé)
  net: number; // revenue − cost
  durationSecs: number; // temps de raffinage estimé
  netPerHour: number; // net / (durée en h)
};

/** Réponse Rust get_refinery_sell_prices : un tableau de meilleurs terminaux par commodity. */
export type RefinerySellRow = {
  commodityName: string;
  terminal: string;
  system: string;
  priceSell: number;
  scuDemand: number;
  updatedAt: string | null;
};
