import { Shield, Palette, Cpu, Sprout, Package, type LucideIcon } from "lucide-react";
import type { CosmeticKind, KindFilter } from "./lib/cosmetics";

/* Affichage des Cosmétiques : icône et libellé par type (couleurs = jetons du thème). */

export const KIND_UI: Record<CosmeticKind, { labelKey: string; Icon: LucideIcon }> = {
  fps: { labelKey: "items.kindFps", Icon: Shield },
  skin: { labelKey: "items.kindSkin", Icon: Palette },
  comp: { labelKey: "items.kindComponent", Icon: Cpu },
  deco: { labelKey: "items.kindHangarDeco", Icon: Sprout },
  other: { labelKey: "items.chipOther", Icon: Package },
};

/** Puces de filtre, dans l'ordre d'affichage. */
export const KIND_CHIPS: ReadonlyArray<readonly [KindFilter, string]> = [
  ["all", "items.chipAll"],
  ["fps", "items.chipFps"],
  ["skin", "items.chipSkin"],
  ["comp", "items.chipComponent"],
  ["deco", "items.chipHangarDeco"],
  ["other", "items.chipOther"],
];

// Normalise une URL d'image RSI (réplique utils/rsiImageUrl.ts V1).
export function normalizeRsiImageUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  if (trimmed.startsWith("/")) return `https://robertsspaceindustries.com${trimmed}`;
  return null;
}

/** Valeur d'un pack en dollars (« 1 234,5 $ »), « — » si inconnue ou nulle. */
export function fmtPackValue(usd: number | null): string {
  return usd != null && usd > 0 ? `${usd.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} $` : "—";
}
