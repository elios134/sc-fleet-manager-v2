/* Types de la page d'un pack (miroir de la commande get_pack_detail). */

export type PackShip = {
  shipId: number | null;
  shipName: string;
  manufacturer: string;
  role: string | null;
  lti: number | null;
  insuranceDuration: number | null;
  insuranceExpiry: string | null;
  imageUrl: string | null;
};

export type PackDetail = {
  pledgeId: number;
  pledgeName: string;
  pledgeType: string;
  createdDate: string | null;
  currentValueUsd: number | null;
  isUpgraded: number;
  shipsCount: number;
  ltiShipsCount: number;
  manufacturersCount: number;
  ships: PackShip[];
};
