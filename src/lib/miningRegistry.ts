// Registre statique du minage (formule de raffinage + référentiel minéraux).
//
// HYBRIDE : ce fichier porte la FORMULE (méthodes de raffinage, propriétés minéraux) ;
// la couche VALEUR (prix de vente par terminal) vient de UEX en live (commande Rust
// get_refinery_sell_prices, lecture de UexCommodityPrice). Snapshot daté par patch.
//
// ⚠️ Les profils speed/cost/yield des 9 méthodes sont sourcés (starcitizen.tools/Refining
// + guides communautaires : expcarry, TEST). Les MULTIPLICATEURS numériques ci-dessous
// sont un MODÈLE calibré sur ces profils qualitatifs (le jeu module par matériau, non
// publié proprement) — ils donnent le bon classement relatif des méthodes ; à affiner
// contre un export de données jeu. Les prix restent réels (UEX).
//
// Snapshot : SC 4.x (sept. 2026).

export type SpeedTier = "veryLow" | "low" | "moderate" | "high" | "veryHigh";
export type Tier3 = "low" | "moderate" | "high";

export type RefineMethod = {
  key: string;
  name: string;
  speed: SpeedTier; // vitesse de traitement (haut = plus rapide)
  costTier: Tier3;
  yieldTier: Tier3;
  yieldMult: number; // × rendement raffiné (référence yield moderate = 1.00)
  costMult: number; // × coût de base (référence cost low = 1.00)
  durationMult: number; // × temps de base (référence Cormack, le plus rapide = 1.00)
};

// Mapping tier → multiplicateur (modèle documenté).
const YIELD: Record<Tier3, number> = { low: 0.9, moderate: 1.0, high: 1.1 };
const COST: Record<Tier3, number> = { low: 1.0, moderate: 1.75, high: 2.6 };
const DUR: Record<SpeedTier, number> = { veryHigh: 0.6, high: 1.0, moderate: 1.7, low: 2.6, veryLow: 3.6 };

function method(
  key: string,
  name: string,
  speed: SpeedTier,
  costTier: Tier3,
  yieldTier: Tier3,
): RefineMethod {
  return { key, name, speed, costTier, yieldTier, yieldMult: YIELD[yieldTier], costMult: COST[costTier], durationMult: DUR[speed] };
}

// Les 9 méthodes de raffinage. Profils = données communautaires ; ils échangent
// délibérément vitesse ↔ coût ↔ rendement.
export const METHODS: RefineMethod[] = [
  method("dinyx", "Dinyx Solventation", "veryLow", "low", "high"),
  method("ferron", "Ferron Exchange", "low", "moderate", "high"),
  method("pyrometric", "Pyrometric Chromalysis", "low", "high", "high"),
  method("thermonatic", "Thermonatic Deposition", "low", "low", "moderate"),
  method("electrostarolysis", "Electrostarolysis", "moderate", "moderate", "moderate"),
  method("gaskin", "Gaskin Process", "high", "high", "moderate"),
  method("kazen", "Kazen Winnowing", "moderate", "low", "low"),
  method("cormack", "Cormack Method", "high", "moderate", "low"),
  method("xcr", "XCR Reaction", "veryHigh", "high", "low"),
];

export type MineralTier = "common" | "industrial" | "precious" | "rare" | "exotic";

export type Mineral = {
  key: string;
  name: string;
  commodity: string; // nom UEX (UexCommodityPrice.commodityName) pour la vente
  tier: MineralTier;
};

// Minéraux raffinables (le brut mine → raffiné vendu). L'ordre = valeur décroissante
// approximative. `commodity` = nom exact côté UEX pour la recherche de prix.
export const MINERALS: Mineral[] = [
  { key: "quantanium", name: "Quantanium", commodity: "Quantanium", tier: "exotic" },
  { key: "bexalite", name: "Bexalite", commodity: "Bexalite", tier: "rare" },
  { key: "taranite", name: "Taranite", commodity: "Taranite", tier: "rare" },
  { key: "borase", name: "Borase", commodity: "Borase", tier: "rare" },
  { key: "laranite", name: "Laranite", commodity: "Laranite", tier: "precious" },
  { key: "beryl", name: "Beryl", commodity: "Beryl", tier: "precious" },
  { key: "agricium", name: "Agricium", commodity: "Agricium", tier: "precious" },
  { key: "hephaestanite", name: "Hephaestanite", commodity: "Hephaestanite", tier: "precious" },
  { key: "gold", name: "Gold", commodity: "Gold", tier: "precious" },
  { key: "diamond", name: "Diamond", commodity: "Diamond", tier: "precious" },
  { key: "titanium", name: "Titanium", commodity: "Titanium", tier: "industrial" },
  { key: "tungsten", name: "Tungsten", commodity: "Tungsten", tier: "industrial" },
  { key: "copper", name: "Copper", commodity: "Copper", tier: "industrial" },
  { key: "corundum", name: "Corundum", commodity: "Corundum", tier: "common" },
  { key: "quartz", name: "Quartz", commodity: "Quartz", tier: "common" },
  { key: "iron", name: "Iron", commodity: "Iron", tier: "common" },
  { key: "aluminum", name: "Aluminum", commodity: "Aluminum", tier: "common" },
  { key: "tin", name: "Tin", commodity: "Tin", tier: "common" },
  { key: "silicon", name: "Silicon", commodity: "Silicon", tier: "common" },
];

// Prix de vente RAFFINÉ de repli (aUEC/SCU), utilisés seulement si UEX n'est pas
// synchronisé (mode hors-ligne). Ordre de grandeur, non contractuel — UEX prime dès
// qu'il est dispo. Source : moyennes communautaires SC 4.x.
export const FALLBACK_SELL: Record<string, number> = {
  quantanium: 8800,
  bexalite: 4600,
  taranite: 3900,
  borase: 3800,
  laranite: 3100,
  beryl: 2900,
  agricium: 2750,
  hephaestanite: 2600,
  gold: 6300,
  diamond: 6800,
  titanium: 430,
  tungsten: 430,
  copper: 550,
  corundum: 330,
  quartz: 330,
  iron: 260,
  aluminum: 260,
  tin: 250,
  silicon: 200,
};

// Constantes d'estimation coût/temps de raffinage (modèle, à affiner). Le coût et le
// temps du jeu montent avec la quantité (et le matériau) ; on modélise linéairement par
// SCU brut, la méthode appliquant ses multiplicateurs. Impact : donne le bon ARBITRAGE
// entre méthodes ; les valeurs absolues sont indicatives.
export const REFINE_COST_PER_SCU = 260; // aUEC / SCU brut, à la base (cost low)
export const REFINE_SECS_PER_SCU = 95; // secondes / SCU brut, à la base (Cormack)

// Decks de raffinage (où déposer le brut). La MÉTHODE se choisit au terminal
// « Refinement Processing » sur place — donc tous les decks proposent les 9 méthodes ;
// cette liste sert juste à savoir OÙ aller. Liste statique curée, datée (SC 4.x) — à
// tenir à jour par patch. Source : starcitizen.tools/Refinery_Deck + UEX.
export type Refinery = { name: string; system: string };
export const REFINERIES: Refinery[] = [
  // Stanton
  { name: "ARC-L1 Wide Forest", system: "Stanton" },
  { name: "ARC-L2 Lively Pathway", system: "Stanton" },
  { name: "ARC-L4 Faint Glen", system: "Stanton" },
  { name: "CRU-L1 Ambitious Dream", system: "Stanton" },
  { name: "HUR-L1 Green Glade", system: "Stanton" },
  { name: "HUR-L2 Faithful Dream", system: "Stanton" },
  { name: "MIC-L1 Shallow Frontier", system: "Stanton" },
  { name: "MIC-L2 Long Forest", system: "Stanton" },
  { name: "MIC-L5 Modern Icarus", system: "Stanton" },
  // Pyro
  { name: "Ruin Station", system: "Pyro" },
  { name: "Checkmate Station", system: "Pyro" },
  { name: "Orbituary Station", system: "Pyro" },
];

export const mineralByKey: Record<string, Mineral> = Object.fromEntries(MINERALS.map((m) => [m.key, m]));
export const methodByKey: Record<string, RefineMethod> = Object.fromEntries(METHODS.map((m) => [m.key, m]));
