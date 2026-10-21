// Journalisation minimale des erreurs auparavant avalées en silence (.catch(() => {})).
// But : rendre le débogage possible sans changer le flux (ne relance pas). À utiliser sur
// les chargements/opérations critiques ; les catch vraiment attendus (best-effort) peuvent
// rester muets.

export function logError(scope: string, e: unknown): void {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`[${scope}] ${msg}`, e);
}

