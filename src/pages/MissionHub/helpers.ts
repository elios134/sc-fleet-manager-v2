// Types et logique pure du Mission Hub (ex-missionShared + constantes de la page).
import { Crosshair, Package, LifeBuoy, Wrench, CircleDot } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  deriveStarRating,
  renderStars,
  formatRewardRange,
  calculateUecPerHour,
  formatUecPerHourCompact,
} from "../../lib/missionStats";

/* ── Types (identiques à la V1 MissionListItem) ── */

export type MissionListItem = {
  uuid: string;
  title: string;
  description: string | null;
  factionName: string | null;
  factionUuid: string | null;
  factionType: string | null;
  rewardScope: string | null;
  illegal: boolean;
  legalityLabel: string | null;
  hasBlueprints: boolean;
  blueprintDropChance: number | null;
  rewardMin: number | null;
  rewardMax: number | null;
  rewardCurrency: string | null;
  timeMins: number | null;
  shareable: boolean;
  hasCombat: boolean;
  hasHauling: boolean;
  hasDefend: boolean;
  minStandingName: string | null;
  minStandingValue: number | null;
  maxStandingName: string | null;
  maxStandingValue: number | null;
  released: boolean;
  workInProgress: boolean;
  notForRelease: boolean;
  starSystems: string | null;
  reputationGained: string | null;
  cooldownJson: string | null;
  reputationAmount: number | null;
  gameVersion: string | null;
  webUrl: string | null;
  source: string;
  blueprints: Array<{ name: string; itemUuid: string }>;
};

export type ObjectiveItem = {
  uuid: string;
  title: string;
  factionName: string | null;
  rewardScope: string | null;
  reputationAmount: number | null;
  minStandingName: string | null;
  minStandingValue: number | null;
  status: string | null;
  notes: string | null;
  updatedAt: string | null;
};

export type FavoriteItem = {
  uuid: string;
  title: string;
  factionName: string | null;
  rewardScope: string | null;
  reputationAmount: number | null;
  note: string | null;
  createdAt: string | null;
};


/* ── Helpers visuels (réplique missionHelpers.ts V1) ── */

type ScopeFamily = "combat" | "cargo" | "hauling" | "recovery" | "salvage" | "other";

// Couleurs par famille (codes V1 adaptés au thème V2 : combat=rouge, cargo/hauling=or,
// recovery=bleu, salvage/other=neutre).
export const FAMILY: Record<ScopeFamily, { color: string; bg: string; border: string }> = {
  combat: { color: "#f87171", bg: "rgba(248,113,113,0.14)", border: "rgba(248,113,113,0.30)" },
  cargo: { color: "#fbbf24", bg: "rgba(251,191,36,0.14)", border: "rgba(251,191,36,0.30)" },
  hauling: { color: "#fbbf24", bg: "rgba(251,191,36,0.14)", border: "rgba(251,191,36,0.30)" },
  recovery: { color: "#60a5fa", bg: "rgba(96,165,250,0.14)", border: "rgba(96,165,250,0.30)" },
  salvage: { color: "rgba(255,255,255,0.6)", bg: "rgba(255,255,255,0.06)", border: "rgba(255,255,255,0.12)" },
  other: { color: "rgba(255,255,255,0.6)", bg: "rgba(255,255,255,0.06)", border: "rgba(255,255,255,0.12)" },
};

export function mapScopeFamily(m: MissionListItem): ScopeFamily {
  const s = (m.rewardScope ?? "").toLowerCase();
  if (
    m.hasCombat || s.includes("combat") || s.includes("assassin") || s.includes("bounty") ||
    s.includes("patrol") || s.includes("elimin") || s.includes("murder") || s.includes("hunt")
  )
    return "combat";
  if (s.includes("salvage")) return "salvage";
  if (s.includes("recovery") || s.includes("rescue") || s.includes("retrieval")) return "recovery";
  if (m.hasHauling || s.includes("hauling")) return "hauling";
  if (s.includes("cargo") || s.includes("delivery") || s.includes("transport")) return "cargo";
  return "other";
}

export function deriveTierLabel(v: number | null, t: (key: string) => string): string {
  switch (deriveStarRating(v)) {
    case 1: return t("mission.tier.beginner");
    case 2: return t("mission.tier.accessible");
    case 3: return t("mission.tier.standard");
    case 4: return t("mission.tier.advanced");
    default: return t("mission.tier.high");
  }
}

// Ré-export pour Dashboard/MissionHub (définitions dans lib/missionStats, importées ci-dessus).
export { deriveStarRating, renderStars, formatRewardRange, calculateUecPerHour, formatUecPerHourCompact };

// Masque les descriptions à template dynamique non résolu (~mission(...), etc.).
export function isCleanDescription(d: string | null): boolean {
  if (!d) return false;
  return !/~(?:mission_giver|mission|ship|location|item)\(/.test(d);
}

/* ── Scope / Rank (réputation) ── */

type Rank = {
  id: string;
  scopeId: string;
  name: string;
  nameKey: string;
  minReputation: number;
  rangeXP: number | null;
  rankIndex: number;
};
export type ScopeWithRanks = { id: string; scopeName: string; displayName: string; ranks: Rank[] };
export type ScopeProgress = {
  id: number;
  accountId: string;
  scopeId: string;
  currentReputation: number;
  declaredAt: string;
  updatedAt: string;
};

// Mapping mission.rewardScope → scopeName interne (réplique scopeMapping.ts V1).
const SCOPE_NAME_MAP: Record<string, string | null> = {
  Assassination: "Assassination",
  "Bounty Hunter": "BountyHunter",
  "Bounty Hunters Guild": "BountyHunter_BountyHuntersGuild",
  Cargo: null,
  "Cargo Transport": null,
  Combat: "ShipCombat_HeadHunters",
  "Combat Assist": "ShipCombat_HeadHunters",
  Delivery: null,
  Hauling: "Hauling",
  Medical: null,
  Mining: null,
  Security: "Security",
  Transport: "Hauling",
  Recovery: null,
  Salvage: null,
  Wikelo: "Wikelo",
};

export function mapRewardScopeToScopeName(rewardScope: string | null): string | null {
  if (!rewardScope) return "FactionReputation";
  return SCOPE_NAME_MAP[rewardScope] ?? null;
}

type RankComputation = {
  currentRank: Rank | null;
  nextRank: Rank | null;
  progressPercent: number;
  repToNextRank: number;
};

// Réplique fidèle de computeCurrentRank V1 (missionHelpers.ts).
export function computeCurrentRank(currentReputation: number, ranks: Rank[]): RankComputation {
  if (ranks.length === 0) {
    return { currentRank: null, nextRank: null, progressPercent: 0, repToNextRank: 0 };
  }
  const sorted = [...ranks].sort((a, b) => a.rankIndex - b.rankIndex);
  let currentRank: Rank | null = sorted[0] ?? null;
  let nextRank: Rank | null = null;
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    if (r && currentReputation >= r.minReputation) {
      currentRank = r;
      nextRank = sorted[i + 1] ?? null;
    }
  }
  if (!nextRank) {
    return { currentRank, nextRank: null, progressPercent: 100, repToNextRank: 0 };
  }
  const rangeInRank = nextRank.minReputation - (currentRank?.minReputation ?? 0);
  const repInRank = currentReputation - (currentRank?.minReputation ?? 0);
  const progressPercent =
    rangeInRank > 0 ? Math.min(100, Math.round((repInRank / rangeInRank) * 100)) : 0;
  return {
    currentRank,
    nextRank,
    progressPercent,
    repToNextRank: nextRank.minReputation - currentReputation,
  };
}

/* ── Reco de farm (port fidèle de missionHelpers.ts V1) ── */

// Meilleure mission à farmer : parmi les missions publiées de la MÊME faction avec
// reputationAmount>0 et timeMins>0, celle au plus haut ratio réputation/minute.
export function findOptimalMission(
  allMissions: MissionListItem[],
  factionUuid: string | null,
): MissionListItem | null {
  if (!factionUuid) return null;
  const candidates = allMissions.filter(
    (m) =>
      m.released &&
      m.factionUuid === factionUuid &&
      m.reputationAmount != null &&
      m.reputationAmount > 0 &&
      m.timeMins != null &&
      m.timeMins > 0,
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((best, m) => {
    const bRate = (best.reputationAmount ?? 0) / (best.timeMins ?? Infinity);
    const mRate = (m.reputationAmount ?? 0) / (m.timeMins ?? Infinity);
    return mRate > bRate ? m : best;
  });
}

// Nombre de runs pour combler la réputation manquante (0 si déjà atteint, ∞ si rep/run≤0).
export function computeRepeatsNeeded(target: number, current: number, perRun: number): number {
  if (current >= target) return 0;
  if (perRun <= 0) return Infinity;
  return Math.ceil((target - current) / perRun);
}

// Temps total de farm en minutes (runs × durée d'un run).
export function computeTotalFarmTime(repeats: number, durMinsPerRun: number): number {
  if (repeats === 0) return 0;
  return repeats * durMinsPerRun;
}

export type ListFilter = "all" | "objectives" | "favorites" | "loot";
export type SortOrder = "rep_desc" | "duration_asc" | "alpha";
export type FicheTab = "details" | "drop";
export const PER_PAGE = 40;

// Icône par famille de scope (mêmes familles que FAMILY / mapScopeFamily).
export const FAMILY_ICON: Record<string, LucideIcon> = {
  combat: Crosshair,
  cargo: Package,
  hauling: Package,
  recovery: LifeBuoy,
  salvage: Wrench,
  other: CircleDot,
};

export type MissionBlueprintDrop = {
  id: string;
  name: string | null;
  category: string | null;
  size: number | null;
  weight: number | null;
};
