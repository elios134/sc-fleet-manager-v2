// Verdict du duel (logique pure, testée) : qui gagne le plus de critères comparables.

export type DuelVerdict = { winner: "a" | "b" | "tie"; wins: number; total: number };

/** Gagnant, son nombre de critères gagnés et le total comparable ; égalité si scores identiques. */
export function duelVerdict(d: { winsA: number; winsB: number; comparable: number }): DuelVerdict {
  const winner = d.winsA === d.winsB ? "tie" : d.winsA > d.winsB ? "a" : "b";
  return { winner, wins: Math.max(d.winsA, d.winsB), total: d.comparable };
}
