// Logique pure de l'onglet Personnages.
import type { CatalogPreset, LocalPreset } from "../types";

/** Même nettoyage que le nom de fichier côté Rust (sanitize_file_name), en minuscules. */
const key = (s: string) => s.trim().replace(/[<>:"/\\|?*]/g, "_").replace(/^[. ]+|[. ]+$/g, "").toLowerCase();

export function installedNames(locals: LocalPreset[]): Set<string> {
  return new Set(locals.map((l) => key(l.name)));
}

export function isInstalled(title: string, names: Set<string>): boolean {
  return names.has(key(title));
}

export function mergePages(prev: CatalogPreset[], next: CatalogPreset[]): CatalogPreset[] {
  const seen = new Set(prev.map((p) => p.id));
  return [...prev, ...next.filter((p) => !seen.has(p.id))];
}

export interface LocalGroup {
  name: string;
  channels: string[];
  paths: string[];
  modifiedAt: string | null;
}

/** Un preset par nom, avec les canaux où il est installé (tri alphabétique). */
export function uniqueLocal(locals: LocalPreset[]): LocalGroup[] {
  const map = new Map<string, LocalGroup>();
  for (const l of locals) {
    const g = map.get(key(l.name)) ?? { name: l.name, channels: [], paths: [], modifiedAt: l.modifiedAt };
    g.channels.push(l.channel);
    g.paths.push(l.path);
    if (l.modifiedAt && (!g.modifiedAt || l.modifiedAt > g.modifiedAt)) g.modifiedAt = l.modifiedAt;
    map.set(key(l.name), g);
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}
