// Bandeau d'état de la page Paramètres : fraîcheur des données et tons des pastilles. Pur, testé.
export type Tone = "ok" | "warn" | "off";
export type DataSummary = { ok: number; stale: number; never: number };

/** Sources à jour / à rafraîchir / jamais synchronisées, d'après leurs dates de dernière synchro. */
export function dataFreshnessSummary(lastSync: Record<string, string | null>, now: Date, staleMs: number): DataSummary {
  const out: DataSummary = { ok: 0, stale: 0, never: 0 };
  for (const iso of Object.values(lastSync)) {
    const t = iso ? Date.parse(iso) : NaN;
    if (Number.isNaN(t)) out.never++;
    else if (now.getTime() - t >= staleMs) out.stale++;
    else out.ok++;
  }
  return out;
}

export function dataTone(s: DataSummary): Tone {
  return s.stale === 0 && s.never === 0 ? "ok" : "warn";
}

export function accountTone(active: { sessionActive: boolean } | null): Tone {
  return active?.sessionActive ? "ok" : "off";
}
