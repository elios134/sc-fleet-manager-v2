// Cosmétiques (logique pure, testée) : objets regroupés par pack (pledge), type d'un objet,
// vaisseau concerné tiré du titre, recherche + filtre, compteurs par type.
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

/** Vaisseau concerné, seulement pour une peinture ou un composant (les autres objets titrés
 *  « X - Y » ne visent pas un vaisseau). */
export const shipFor = (it: HangarItem): string | null => {
  const k = cosmeticKind(it);
  return k === "skin" || k === "comp" ? shipOfTitle(it.title) : null;
};

const norm = (s: string | null | undefined) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Un pack (pledge RSI) et ses objets. */
export type Pack = { id: number; name: string; valueUsd: number | null; createdDate: string | null; items: HangarItem[] };

/** Regroupe les objets par pack, triés par nom de pack (`fallbackName` si le pledge n'en a pas). */
export function groupPacks(items: HangarItem[], fallbackName: (id: number) => string = (id) => `#${id}`): Pack[] {
  const byId = new Map<number, Pack>();
  for (const it of items) {
    let p = byId.get(it.pledgeId);
    if (!p) {
      p = { id: it.pledgeId, name: it.pledgeName ?? fallbackName(it.pledgeId), valueUsd: it.pledgeValueUsd, createdDate: it.pledgeCreatedDate, items: [] };
      byId.set(it.pledgeId, p);
    }
    p.items.push(it);
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const packHasKind = (p: Pack, kind: KindFilter) => kind === "all" || p.items.some((it) => cosmeticKind(it) === kind);

/** Packs filtrés : recherche sur le nom du pack et le titre / type / fabricant de ses objets
 *  (sans casse ni accents) ; un pack correspond au type s'il contient au moins un tel objet. */
export function viewPacks(packs: Pack[], f: { q: string; kind: KindFilter }): Pack[] {
  const q = norm(f.q.trim());
  return packs.filter(
    (p) => packHasKind(p, f.kind) && (!q || norm(p.name).includes(q) || p.items.some((it) => norm(`${it.title} ${it.kind} ${it.manufacturer}`).includes(q))),
  );
}

/** Nombre de packs par type, sur tout le hangar. */
export function packKindCounts(packs: Pack[]): Record<KindFilter, number> {
  const kinds: KindFilter[] = ["all", "fps", "skin", "comp", "deco", "other"];
  return Object.fromEntries(kinds.map((k) => [k, packs.filter((p) => packHasKind(p, k)).length])) as Record<KindFilter, number>;
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
