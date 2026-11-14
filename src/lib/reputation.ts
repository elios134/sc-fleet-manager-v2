// Réputation par faction : contrat de get_reputation_overview (src-tauri/src/commands/reputation) et
// logique d'affichage pure, partagés par les onglets Réputation et Reprendre ma partie.

export interface RankDef {
  name: string;
  min: number;
  range: number | null;
}
export interface JournalEntry {
  at: string;
  title: string;
  amount: number;
  loot: string[];
}
export interface AdviceEntry {
  title: string;
  amount: number;
  timeMins: number;
  perHour: number;
  minRank: string | null;
}
export interface FactionRep {
  faction: string;
  scopeId: string;
  scopeLabel: string | null;
  monogram: string;
  ranks: RankDef[];
  total: number;
  rankIndex: number;
  inRank: number;
  toNext: number | null;
  rankSource: "declared" | "deduced" | "unknown";
  deduced: { rankName: string; title: string; at: string } | null;
  declared: { rankIndex: number; repInRank: number; at: string } | null;
  gained: number;
  missions: number;
  lastAt: string;
  journal: JournalEntry[];
  advice: AdviceEntry[];
  missionsLeft: number | null;
}
export interface ReputationOverview {
  factions: FactionRep[];
  unmatched: number;
}

/** Part du rang en cours déjà gagnée (0-100) ; 100 au rang maximal. */
export function progressPct(f: Pick<FactionRep, "inRank" | "toNext">): number {
  if (f.toNext == null) return 100;
  const span = f.inRank + f.toNext;
  return span > 0 ? Math.round((f.inRank / span) * 100) : 0;
}

export function factionKey(f: Pick<FactionRep, "faction" | "scopeId">): string {
  return `${f.faction}|${f.scopeId}`;
}

// Palette de données des emblèmes (jetons du thème), choisie par le nom de la faction.
const HUES = ["var(--info)", "var(--gold)", "var(--danger)", "var(--success)", "var(--teal)", "var(--coral)", "var(--accent)", "var(--copper)"];

export function factionHue(name: string): string {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return HUES[h % HUES.length];
}
