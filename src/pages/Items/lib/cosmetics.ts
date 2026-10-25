// Vue « liste + fiche » des Cosmétiques (logique pure, testée) : type d'un objet, vaisseau
// concerné tiré du titre, recherche + filtre, compteurs par type.
import type { HangarItem } from "../types";

export type CosmeticKind = "fps" | "skin" | "comp" | "deco" | "other";
export type KindFilter = CosmeticKind | "all";

const RSI_KINDS: Record<string, CosmeticKind> = {
  "FPS Equipment": "fps",
  Skin: "skin",
  Component: "comp",
  "Hangar decoration": "deco",
};

/** Type d'affichage d'un objet ; kinds RSI inconnus ou absents → « other ». */
export const cosmeticKind = (it: HangarItem): CosmeticKind => (it.kind && RSI_KINDS[it.kind]) || "other";

/** Vaisseau concerné par une peinture / un composant (« Scorpius - IceBreak Paint » → Scorpius). */
export function shipOfTitle(title: string): string | null {
  const i = title.indexOf(" - ");
  return i > 0 ? title.slice(0, i).trim() : null;
}

const norm = (s: string | null | undefined) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Objets filtrés (titre ou pack, type) et triés par titre. */
export function viewCosmetics(items: HangarItem[], f: { q: string; kind: KindFilter }): HangarItem[] {
  const q = norm(f.q.trim());
  return items
    .filter((it) => (!q || norm(`${it.title} ${it.pledgeName}`).includes(q)) && (f.kind === "all" || cosmeticKind(it) === f.kind))
    .sort((a, b) => a.title.localeCompare(b.title));
}

/** Nombre d'objets par type, sur tout le hangar. */
export function kindCounts(items: HangarItem[]): Record<KindFilter, number> {
  const c: Record<KindFilter, number> = { all: items.length, fps: 0, skin: 0, comp: 0, deco: 0, other: 0 };
  for (const it of items) c[cosmeticKind(it)]++;
  return c;
}

const words = (s: string) => norm(s).split(/[^a-z0-9]+/).filter(Boolean);
/** Le vaisseau concerné est-il dans la flotte ? (« Wolf » ⊂ « L-22 Alpha Wolf »). */
export function inFleet(ship: string, fleetNames: string[]): boolean {
  const w = words(ship);
  return w.length > 0 && fleetNames.some((n) => {
    const fw = words(n);
    return w.every((x) => fw.includes(x));
  });
}
