import type { OverlayStep, TimersSample } from "../../components/overlay/hudParts";

/* Données d'exemple pour l'aperçu de l'overlay (aucun appel backend).
   Une route de commerce représentative + un cycle Hangar ouvert et deux timers. */

export const SAMPLE_SHIP = "Constellation Taurus";
export const SAMPLE_ACTIVE_INDEX = 1;
export const SAMPLE_REFUEL_INDEX = 1;

export const SAMPLE_STEPS: OverlayStep[] = [
  { from: "Area18", to: "Everus Harbor", commodity: "Laranite", profit: 0, scu: 96, minutes: 6.4, jumps: 1 },
  { from: "Everus Harbor", to: "Port Tressler", commodity: "Agricium", profit: 41200, scu: 96, minutes: 9.1, jumps: 1 },
  { from: "Port Tressler", to: "Baijini Point", commodity: "Titanium", profit: 38650, scu: 96, minutes: 7.8 },
  { from: "Baijini Point", to: "CRU-L1", commodity: "Quantanium", profit: 52900, scu: 64, minutes: 5.2 },
];

// Timers ancrés sur l'heure courante → l'aperçu décompte de façon crédible.
export function makeSampleTimers(): TimersSample {
  const base = Date.now();
  return {
    hangar: {
      status: { status: "ONLINE", secondsRemaining: 2472, cycleNumber: 142, nextChangeMs: base + 41 * 60000 + 12000 },
      upcoming: [{ eventType: "Online", atMs: base + 3 * 3600000, cycleNumber: 143 }],
    },
    timers: {
      terminals: [
        { id: "t-everus", label: "Terminal A — Everus", location: "Everus Harbor", timerSeconds: 0 },
        { id: "t-tressler", label: "Terminal C — Tressler", location: "Port Tressler", timerSeconds: 0 },
      ],
      activeTimers: [
        { terminalId: "t-everus", endsAtMs: base + 12 * 60000 + 38000, secondsRemaining: 758 },
        { terminalId: "t-tressler", endsAtMs: base + 64 * 60000 + 57000, secondsRemaining: 3897 },
      ],
    },
  };
}
