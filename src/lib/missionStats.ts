// Helpers d'économie/notation des missions (purs). Extraits de MissionIntelPage car
// partagés par plusieurs pages (Dashboard, MissionHub) — la page les ré-exporte pour
// compatibilité.

export type MissionReward = {
  rewardMin: number | null;
  rewardMax: number | null;
  timeMins: number | null;
};

/** Note 1–5 étoiles dérivée d'une valeur de réputation/standing. */
export function deriveStarRating(v: number | null): number {
  if (!v) return 1;
  if (v < 10_000) return 2;
  if (v < 50_000) return 3;
  if (v < 100_000) return 4;
  return 5;
}

/** Étoiles pleines/vides en glyphes (clampé 1–5). */
export function renderStars(count: number): string {
  const n = Math.max(1, Math.min(5, count));
  return "●".repeat(n) + "○".repeat(5 - n);
}

/** Grand nombre compact : 1 500 000 → "1.5M", 12 000 → "12K". */
export function formatLargeNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

/** Fourchette de récompense formatée ("12K–30K", "—" si inconnue). */
export function formatRewardRange(m: MissionReward): string {
  if (m.rewardMin == null || m.rewardMax == null) return "—";
  const min = formatLargeNumber(m.rewardMin);
  const max = formatLargeNumber(m.rewardMax);
  return min === max ? max : `${min}–${max}`;
}

/** aUEC/heure (moyenne récompense / temps), null si données incomplètes. */
export function calculateUecPerHour(m: MissionReward): number | null {
  if (m.rewardMin == null || m.rewardMax == null || !m.timeMins) return null;
  const avg = (m.rewardMin + m.rewardMax) / 2;
  return Math.round(avg / (m.timeMins / 60));
}

/** aUEC/h compact ("30K/h", "—" si null). */
export function formatUecPerHourCompact(v: number | null): string {
  return v == null ? "—" : `${formatLargeNumber(v)}/h`;
}
