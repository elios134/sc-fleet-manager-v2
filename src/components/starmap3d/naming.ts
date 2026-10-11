// Jointure de noms VerseTime↔RSI + URL des textures CDN. Fonctions pures.
export const STARMAP_DATA_BASE = "https://cdn.jsdelivr.net/gh/elios134/sc-fleet-starmap-data@main";

/** Clé de jointure : minuscules, sans accents, sans espaces/ponctuation. */
export function bodyKey(name: string): string {
  return String(name ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** URL jsDelivr de la texture équirectangulaire d'un corps. */
export function texUrlFor(name: string): string {
  return `${STARMAP_DATA_BASE}/planets/${bodyKey(name)}.webp`;
}
