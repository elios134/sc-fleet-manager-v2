/* Types de l'onglet Cosmétiques. */

export type HangarItem = {
  id: number;
  pledgeId: number;
  accountId: string;
  title: string;
  kind: string | null;
  imageUrl: string | null;
  manufacturer: string | null;
  pledgeName: string | null;
  pledgeValueUsd: number | null;
  pledgeCreatedDate: string | null;
};
