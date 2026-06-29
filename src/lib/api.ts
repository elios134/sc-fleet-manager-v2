import { invoke } from "@tauri-apps/api/core";

// Petite couche de cache mémoire au-dessus d'invoke() pour les lectures de RÉFÉRENCE
// (données quasi statiques). NE PAS utiliser pour des données qui changent souvent ou
// après une mutation — réserver aux catalogues/loadouts de référence.
type Entry = { data: unknown; ts: number };
const cache = new Map<string, Entry>();

const DEFAULT_TTL = 5 * 60 * 1000; // 5 min

/** invoke() avec cache mémoire (clé = cmd + args). `ttl` en ms. */
export async function cachedInvoke<T>(cmd: string, args?: Record<string, unknown>, ttl = DEFAULT_TTL): Promise<T> {
  const key = `${cmd}:${args ? JSON.stringify(args) : ""}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < ttl) return hit.data as T;
  const data = await invoke<T>(cmd, args);
  cache.set(key, { data, ts: Date.now() });
  return data;
}

/** Invalide une entrée (ou tout le cache si cmd omis) — à appeler après une mutation. */
export function invalidateCache(cmd?: string): void {
  if (!cmd) {
    cache.clear();
    return;
  }
  for (const k of cache.keys()) if (k.startsWith(`${cmd}:`)) cache.delete(k);
}
