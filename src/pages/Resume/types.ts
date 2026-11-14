// Contrat de get_last_session (src-tauri/src/commands/resume.rs).
export type SessionItem =
  | { kind: "login"; at: string; character: string | null }
  | { kind: "vehicle"; at: string; vehicle: string | null }
  | { kind: "system"; at: string; system: string | null }
  | { kind: "quantum"; at: string; count: number; destination: string | null }
  | { kind: "death"; at: string; zone: string | null; killer: string | null; victim: string | null }
  | { kind: "accepted"; at: string; title: string | null }
  | { kind: "ended"; at: string; outcome: string | null; title: string | null; rep: { faction: string; amount: number }[]; loot: string[] };

export interface LastSession {
  start: string | null;
  durationSeconds: number;
  location: string | null;
  system: string | null;
  items: SessionItem[];
}
