// Contrat de src-tauri/src/commands/game_cache.rs et logique pure de l'onglet Cache du jeu.
export interface CacheFolder {
  name: string;
  kind: string; // shaders_old | shaders_current | crashes | other
  version: string | null;
  bytes: number;
  files: number;
}
export interface CacheInfo {
  root: string;
  exists: boolean;
  installedVersion: string | null;
  gameRunning: boolean;
  folders: CacheFolder[];
}

/** Dossiers supprimables sans conséquence : anciennes versions de shaders et rapports de plantage. */
export function safeFolders<T extends Pick<CacheFolder, "kind">>(folders: T[]): T[] {
  return folders.filter((f) => f.kind === "shaders_old" || f.kind === "crashes");
}

export function totalBytes(folders: Pick<CacheFolder, "bytes">[]): number {
  return folders.reduce((n, f) => n + f.bytes, 0);
}

/** « 312 Mo » sous 1 Go, « 3,4 Go » au-delà (unités binaires, comme l'Explorateur). */
export function fmtSize(bytes: number, locale: string): string {
  const mo = bytes / 2 ** 20;
  if (mo < 1024) return `${Math.round(mo).toLocaleString(locale)} Mo`;
  return `${(mo / 1024).toLocaleString(locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 })} Go`;
}

/** Teinte de chaque nature de dossier (jetons du thème). */
export const KIND_COLOR: Record<string, string> = {
  shaders_old: "var(--warning)",
  shaders_current: "var(--info)",
  crashes: "var(--coral)",
  other: "var(--muted-foreground)",
};
