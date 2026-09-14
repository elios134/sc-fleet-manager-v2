// Helpers/types partagés du Catalogue (points de vente). Utilisés par PriceCard, la vue
// par lieu (LocationsTab) et CataloguePage.

import { Crosshair, Shield, Pickaxe, Cpu, Package, type LucideIcon } from "lucide-react";

// Macro-groupes maison (UEX éclate les équipements sur plusieurs sections) :
// vehicle = équipement de vaisseau · character = FPS (armes/armures perso) · misc = autres.
export type MacroGroup = "vehicle" | "character" | "misc";
const VEHICLE_SECTIONS = new Set(["Vehicle Weapons", "Systems", "Avionics", "Propulsion", "Utility", "Module", "Ship Shield", "Ship Quantum", "Ship Cooler", "Ship Power"]);
const CHARACTER_SECTIONS = new Set(["Armor", "Personal Armor", "Personal Weapons", "Personal Weapon", "Undersuits", "Undersuit", "Clothing"]);
export function macroGroupOf(section: string | null): MacroGroup {
  if (section && VEHICLE_SECTIONS.has(section)) return "vehicle";
  if (section && CHARACTER_SECTIONS.has(section)) return "character";
  // Repli par mots-clés (sections non listées ci-dessus).
  const s = (section ?? "").toLowerCase();
  if (/ship|vehicle|quantum|shield|cooler|power|thruster|missile rack|weapon mount/.test(s)) return "vehicle";
  if (/armor|armour|weapon|undersuit|clothing|helmet|suit/.test(s)) return "character";
  return "misc";
}

// Icône de repli d'un item quand aucune image n'est disponible.
export function itemIcon(section: string | null, category: string | null): LucideIcon {
  const s = `${section ?? ""} ${category ?? ""}`.toLowerCase();
  if (/weapon|gun|rifle|pistol|arme|missile|ammo/.test(s)) return Crosshair;
  if (/armor|armour|undersuit|helmet|torso|leg|arm|armure|suit|glove|hat/.test(s)) return Shield;
  if (/min|ore|gadget|salvage|harvest/.test(s)) return Pickaxe;
  if (/cooler|power|shield|quantum|component|composant|paint|core|drive/.test(s)) return Cpu;
  return Package;
}

export type PurchasePoint = {
  priceBuy?: number | null;
  price?: number | null;
  terminalName: string | null;
  shopName?: string | null;
  systemName: string | null;
  planetName: string | null;
  moonName: string | null;
  cityName: string | null;
  spaceStationName: string | null;
  outpostName: string | null;
  dateModified: number | null;
};

export function fmt(n: number | null | undefined): string {
  if (n == null) return "—";
  return Math.round(n).toLocaleString("fr-FR");
}

// Lieu lisible d'un point de vente : station/ville/avant-poste/lune/planète · système.
export function locationStr(p: {
  systemName: string | null;
  planetName: string | null;
  moonName: string | null;
  cityName: string | null;
  spaceStationName: string | null;
  outpostName: string | null;
}): string {
  const place = p.spaceStationName || p.cityName || p.outpostName || p.moonName || p.planetName;
  const uniq = [place, p.systemName].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);
  return uniq.length ? uniq.join(" · ") : "—";
}

// Couleur d'accent par système (repli gris). Repris de la DA CargoRoutes/Mining.
export const SYS_COLOR: Record<string, string> = {
  Stanton: "#5aa9e6",
  Pyro: "#f59e0b",
  Nyx: "#12a794",
};
export function sysColor(system: string | null | undefined): string {
  return (system && SYS_COLOR[system]) || "#9ca3af";
}
