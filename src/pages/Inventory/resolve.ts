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
  const hit = bodies.find((b) => segs.includes(key(b.name)));
  if (!hit) return { system: null, planet: null };
  return { system: hit.system, planet: hit.name };
}
