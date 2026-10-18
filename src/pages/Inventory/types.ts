// Miroir TS de l'état Rust (commands/inventory/model.rs, camelCase via serde).
export type Stack = { qte: number; vu: number };
export type Lieu = { code: string | null; nom: string | null };
export type Contenant = { classe: string; scu: number; lieu: number | null };
export type InvState = {
  possessions: Record<string, Record<string, Stack>>;
  sol: Record<string, Record<string, Stack>>;
  lieux: Record<string, Lieu>;
  contenants: Record<string, Contenant>;
  derniereTrace: number | null;
  journalId: string | null;
  journalPos: number;
  curLocNom: string | null;
};
export type InventoryStatus = { active: boolean; derniereTrace: number | null; hasGameLog: boolean };
// Méta d'objet depuis SC Wiki (commands/inventory/meta.rs).
export type ItemMeta = { name: string | null; imageUrl: string | null; classification: string | null };
