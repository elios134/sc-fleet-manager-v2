// Normalisation de la catégorie d'un vaisseau vers les 8 catégories officielles du store RSI.
// Source : ShipData.role (le niveau haut). La sous-catégorie (ShipData.classification) est
// affichée telle quelle à part. Partagé entre la carte (ShipCard) et les filtres (FleetPage).

export const RSI_CATEGORIES = [
  "Combat",
  "Transport",
  "Exploration",
  "Industrial",
  "Support",
  "Competition",
  "Ground",
  "Multi-role",
] as const;
export type RsiCategory = (typeof RSI_CATEGORIES)[number];

// Mapping role (datamining) → catégorie RSI (codé en dur, comme V1).
const ROLE_TO_RSI: Record<string, RsiCategory> = {
  Combat: "Combat",
  Gunship: "Combat",
  Destroyer: "Combat",
  "Snub Fighter": "Combat",
  Transporter: "Transport",
  Transport: "Transport",
  Exploration: "Exploration",
  Industrial: "Industrial",
  Support: "Support",
  Competition: "Competition",
  Ground: "Ground",
  "Multi-Role": "Multi-role",
  "Multi-role": "Multi-role",
  Starter: "Multi-role",
};

// Catégorie RSI normalisée depuis ShipData.role. null si non apparié (pas de ShipData).
// role connu mais non mappé → repli « Multi-role » (jamais de plantage).
export function normalizeRsiCategory(role: string | null | undefined): RsiCategory | null {
  if (!role) return null;
  const token = role.split("/")[0].trim(); // role = niveau haut (1er segment si chaîne)
  if (!token) return null;
  return ROLE_TO_RSI[token] ?? "Multi-role";
}
