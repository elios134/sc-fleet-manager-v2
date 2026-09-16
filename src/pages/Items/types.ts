/* Types de l'onglet « Objets & cosmétiques » (refonte « Hangar Locker »). */

export type HangarItem = {
  id: number;
  pledgeId: number;
  accountId: string;
  title: string;
  kind: string | null;
  imageUrl: string | null;
  manufacturer: string | null;
  pledgeName: string | null;
};

export type PledgeGroup = {
  id: number; // pledgeId
  name: string;
  items: HangarItem[];
};

// Kinds avec un chip/badge dédié ; tout le reste (et kind === null) tombe sous « Autre ».
export type KindFilter =
  | "ALL"
  | "FPS Equipment"
  | "Skin"
  | "Component"
  | "Hangar decoration"
  | "OTHER";
