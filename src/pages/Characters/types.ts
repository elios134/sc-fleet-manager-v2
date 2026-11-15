// Contrat de src-tauri/src/commands/characters.rs.
export interface CatalogPreset {
  id: string;
  title: string;
  author: string | null;
  createdAt: string | null;
  previewUrl: string | null;
  dnaUrl: string;
  downloads: number;
  likes: number;
}
export interface CatalogPage {
  rows: CatalogPreset[];
  hasNextPage: boolean;
}
export interface LocalPreset {
  name: string;
  path: string;
  channel: string;
  modifiedAt: string | null;
}
export interface LocalPresets {
  characters: LocalPreset[];
  gameFound: boolean;
  /** Canaux installés (LIVE, PTU…). */
  channels: string[];
}
export type CatalogOrder = "download" | "latest";
