// Logique pure du planificateur de salvage (même esprit que le minage, plus simple :
// les modules scraper n'ont pas de slots/gadgets). Données = commande Rust
// get_salvage_loadout (UEX cat 31 « Scraper Beams »). Clean-room.
import type { BuyPoint } from "./miningLoadout";

export type SalvageHead = {
  name: string;
  company: string;
  size: number;
  extractionSpeed: number | null;
  radius: number | null;
  efficiency: number | null;
  price: number;
  buy: BuyPoint[];
};
export type SalvageData = { heads: SalvageHead[]; generatedUnix?: number };
export type SalvageShip = { arms: string[]; size: number };
export type SHMap = Record<string, SalvageHead>;

// Vaisseaux de salvage (faits de jeu) : bras de scraping.
export const SALVAGE_SHIPS: Record<string, SalvageShip> = {
  Vulture: { arms: ["Bras scraper"], size: 1 },
  Reclaimer: { arms: ["Bras tribord", "Bras bâbord"], size: 2 },
};

export type SalvageStats = {
  speed: number; // vitesse d'extraction cumulée (additive par bras)
  radius: number | null; // rayon max des bras équipés
  efficiency: number | null; // efficacité moyenne des bras équipés
  price: number;
};

export function combineSalvage(picked: string[], H: SHMap): SalvageStats {
  let speed = 0;
  let price = 0;
  let radius: number | null = null;
  const effs: number[] = [];
  for (const name of picked) {
    const h = H[name];
    if (!h) continue;
    speed += h.extractionSpeed ?? 0;
    price += h.price ?? 0;
    if (h.radius != null) radius = radius == null ? h.radius : Math.max(radius, h.radius);
    if (h.efficiency != null) effs.push(h.efficiency);
  }
  const efficiency = effs.length ? effs.reduce((a, b) => a + b, 0) / effs.length : null;
  return { speed, radius, efficiency, price };
}

export function freshSalvage(ship: string): string[] {
  const cfg = SALVAGE_SHIPS[ship] ?? SALVAGE_SHIPS.Vulture;
  return cfg.arms.map(() => "");
}
