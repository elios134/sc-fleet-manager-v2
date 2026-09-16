import { Shield, Palette, Cpu, Sprout, type LucideIcon } from "lucide-react";
import type { TFunction } from "i18next";
import type { KindFilter, PledgeGroup } from "./types";

/* Helpers purs de l'onglet « Objets & cosmétiques ». */

// Kinds RSI reconnus (un chip/badge coloré) ; tout le reste tombe sous « Autre ».
export const KNOWN_KINDS = new Set(["FPS Equipment", "Skin", "Component", "Hangar decoration"]);

// Métadonnées d'affichage par kind RSI : clé i18n du libellé, teinte, icône.
type KindMeta = {
  slug: "fps" | "skin" | "comp" | "deco";
  labelKey: string;
  color: string; // teinte accent de la catégorie
  Icon: LucideIcon;
};

export const KIND_META: Record<string, KindMeta> = {
  "FPS Equipment": { slug: "fps", labelKey: "items.kindFps", color: "#f59e0b", Icon: Shield },
  Skin: { slug: "skin", labelKey: "items.kindSkin", color: "#e879f9", Icon: Palette },
  Component: { slug: "comp", labelKey: "items.kindComponent", color: "#2ee9a5", Icon: Cpu },
  "Hangar decoration": { slug: "deco", labelKey: "items.kindHangarDeco", color: "#60a5fa", Icon: Sprout },
};

export function kindLabel(kind: string | null, t: TFunction): string | null {
  if (!kind) return null;
  return KIND_META[kind] ? t(KIND_META[kind]!.labelKey) : kind;
}

// Normalise une URL d'image RSI (réplique utils/rsiImageUrl.ts V1).
export function normalizeRsiImageUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  if (trimmed.startsWith("/")) return `https://robertsspaceindustries.com${trimmed}`;
  return null;
}

// Un pledge matche un filtre kind si AU MOINS UN de ses items qualifie.
export function pledgeMatchesKind(p: PledgeGroup, filter: KindFilter): boolean {
  if (filter === "ALL") return true;
  if (filter === "OTHER") return p.items.some((it) => it.kind === null || !KNOWN_KINDS.has(it.kind));
  return p.items.some((it) => it.kind === filter);
}

// Numéros de page « 1 2 3 … last » (même logique que CraftingHubPage).
export function pageNumbers(current: number, total: number): (number | "…")[] {
  const out: (number | "…")[] = [];
  for (let p = 1; p <= total; p++) {
    if (p === 1 || p === total || Math.abs(p - current) <= 1) {
      if (out.length > 0 && out[out.length - 1] !== "…" && p - (out[out.length - 1] as number) > 1) {
        out.push("…");
      }
      out.push(p);
    }
  }
  return out;
}

// [clé i18n du libellé, filtre]
export const CHIPS: ReadonlyArray<readonly [string, KindFilter]> = [
  ["items.chipAll", "ALL"],
  ["items.chipFps", "FPS Equipment"],
  ["items.chipSkin", "Skin"],
  ["items.chipComponent", "Component"],
  ["items.chipHangarDeco", "Hangar decoration"],
  ["items.chipOther", "OTHER"],
];

export const PER_PAGE = 24;
