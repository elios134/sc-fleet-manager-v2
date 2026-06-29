// Hangar Executive (PYAM) — types (miroir de hangar_exec.rs) + helpers purs.
// Les temps sont en epoch MILLIS (le front calcule les secondes restantes via `now`).

export type HangarExecStatus = {
  status: string; // "ONLINE" | "OFFLINE"
  nextChangeMs: number;
  secondsRemaining: number;
  cycleNumber: number;
  initialOpenMs: number;
  versionLabel: string | null;
  lastModified: string | null;
  sourceUrl: string;
};
export type HangarExecScheduleEvent = { eventType: string; atMs: number; cycleNumber: number };
export type HangarExecStatusResponse = { status: HangarExecStatus; upcoming: HangarExecScheduleEvent[] };
export type HangarTerminalPreset = { id: string; label: string; location: string; timerSeconds: number };
export type HangarTerminalTimer = { terminalId: string; endsAtMs: number; secondsRemaining: number };
export type HangarExecTimersResponse = { terminals: HangarTerminalPreset[]; activeTimers: HangarTerminalTimer[] };

// Aligné sur hangar_exec.rs (65 min ouvert / 120 min fermé).
export const PYAM_OPEN_SECONDS = 65 * 60;
export const PYAM_CLOSED_SECONDS = 120 * 60;

/** Compte à rebours mm:ss (les minutes peuvent dépasser 60). */
export function formatCountdown(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** % écoulé de la phase courante (ouverture ou fermeture). */
export function pyamProgressPercent(isOnline: boolean, secondsRemaining: number): number {
  const phaseTotal = isOnline ? PYAM_OPEN_SECONDS : PYAM_CLOSED_SECONDS;
  if (phaseTotal <= 0) return 0;
  const elapsed = Math.max(0, phaseTotal - secondsRemaining);
  return Math.min(100, Math.round((elapsed / phaseTotal) * 100));
}

/** 5 segments de jauge : se remplissent (online) / se vident (offline) avec la progression. */
export function pyamSegmentStates(isOnline: boolean, progressPercent: number): boolean[] {
  const filled = Math.round((progressPercent / 100) * 5);
  return Array.from({ length: 5 }, (_, i) => (isOnline ? i < filled : i >= 5 - filled));
}

/** Regroupe des terminaux par lieu (conserve l'ordre d'insertion). */
export function groupByLocation<T extends { location: string }>(items: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const it of items) {
    const list = map.get(it.location) ?? [];
    list.push(it);
    map.set(it.location, list);
  }
  return map;
}
