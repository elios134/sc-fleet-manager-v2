// Résout un nom de lieu (zone Game.log) → système + planète/lune, via les corps de la carte.
export type BodyRef = { name: string; system: string; parentBody: string | null; navIcon: string };

const key = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

export function resolveScope(
  lieuNom: string | null,
  bodies: BodyRef[],
): { system: string | null; planet: string | null } {
  if (!lieuNom) return { system: null, planet: null };
  const segs = lieuNom.split(/[_\s]+/).map(key).filter(Boolean);
  // On ignore les étoiles (souvent nommées comme le système → masqueraient la planète),
  // et on retient le corps dont le nom apparaît le PLUS TARD dans le nom de lieu (le plus
  // spécifique : « Stanton_microTech_… » → microTech, pas l'étoile Stanton).
  let hit: BodyRef | null = null;
  let bestIdx = -1;
  for (const b of bodies) {
    if (b.navIcon === "Star") continue;
    const idx = segs.lastIndexOf(key(b.name));
    if (idx > bestIdx) { bestIdx = idx; hit = b; }
  }
  if (!hit) return { system: null, planet: null };
  return { system: hit.system, planet: hit.name };
}
