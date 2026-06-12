// Résolution des images top-down Starjump (fleetviewer.link) à partir du nom de vaisseau.
//
// Port fidèle de la V1 (services/starjumpSync.ts) : le HASH des images n'est PAS calculable,
// il provient du manifeste. On embarque un manifeste « slim » (src/data/starjump-ships.json,
// ~45 KB : fleetview + slug + hash par résolution) et on construit l'URL CDN à la volée.
// Aucun appel réseau ici : seule la balise <img> charge l'image depuis le CDN (best-effort,
// fallback géré par l'appelant via onError).
//
// ⚠️ ÉTHIQUE : usage en cours de développement uniquement. Ne pas publier/release ces images
// publiquement sans accord préalable de Starjump (André contactera Starjump_GRIM avant toute
// diffusion publique).

import { invoke } from "@tauri-apps/api/core";
import bundled from "../data/starjump-ships.json";

type Entry = { fv: string; slug: string; l?: string; s?: string; xs?: string };
type Res = "l" | "s" | "xs";

// Source courante : bundle slim au démarrage (disponible immédiatement, hors-ligne OK),
// remplacé par le manifeste réseau/cache via refreshStarjumpManifest() (best-effort).
let entries: Entry[] = bundled as Entry[];
const CDN_BASE = "https://cdn1.fleetviewer.link";
const RES_FALLBACK: Res[] = ["l", "s", "xs"];

// Alias noms SC Wiki/RSI → fleetview Starjump (port V1 STARJUMP_ALIASES).
const STARJUMP_ALIASES: Record<string, string> = {
  "C2 Hercules Starlifter": "hercules starlifter c2",
  "M2 Hercules Starlifter": "hercules starlifter m2",
  "A2 Hercules Starlifter": "hercules starlifter a2",
  "Dragonfly Black": "dragonfly",
  "Ares Inferno": "ares inferno",
  "Ares Star Fighter Inferno": "ares inferno",
  "Ares Starfighter Inferno": "ares inferno",
  "Ares Ion": "ares ion",
  "Ares Star Fighter Ion": "ares ion",
  "Ares Starfighter Ion": "ares ion",
};

let index: Map<string, Entry> | null = null;
function getIndex(): Map<string, Entry> {
  if (index) return index;
  const m = new Map<string, Entry>();
  for (const e of entries) if (!m.has(e.fv)) m.set(e.fv, e);
  index = m;
  return m;
}

let refreshing: Promise<void> | null = null;
/**
 * Rafraîchit le manifeste depuis le backend (cache app data → CDN hangar.link → vide).
 * Best-effort, exécuté une seule fois : un échec laisse le bundle slim en place.
 * À appeler au montage du Loadout / Comparateur.
 */
export function refreshStarjumpManifest(): Promise<void> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const fresh = await invoke<Entry[]>("get_starjump_ships");
      if (Array.isArray(fresh) && fresh.length > 0) {
        entries = fresh;
        index = null; // reconstruit à la prochaine résolution
        cache.clear(); // invalide le cache de résolution
      }
    } catch {
      /* best-effort : on garde le bundle slim */
    }
  })();
  return refreshing;
}

const NOISE = /\b(mk|mark|ii|2|iii|3|iv|4|series|edition|limited|variant)\b/gi;
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[-_]/g, " ")
    .replace(NOISE, "")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const row = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = i;
    for (let j = 1; j <= n; j++) {
      const val = a[i - 1] === b[j - 1] ? row[j - 1]! : 1 + Math.min(prev, row[j]!, row[j - 1]!);
      row[j - 1] = prev;
      prev = val;
    }
    row[n] = prev;
  }
  return row[n]!;
}

// Construit l'URL CDN, avec repli de résolution l → s → xs.
function buildUrl(e: Entry, res: Res): string | null {
  const order: Res[] = [res, ...RES_FALLBACK.filter((r) => r !== res)];
  for (const r of order) {
    const hash = e[r];
    if (hash) return `${CDN_BASE}/${e.slug}__top_${r}_${hash}.png`;
  }
  return null;
}

const cache = new Map<string, string | null>();

/**
 * Résout l'URL de l'image top-down d'un vaisseau depuis son nom.
 * Échelle de correspondance (calque V1) : alias → exact → sous-chaîne → levenshtein (≤ 3).
 * Renvoie null si aucun vaisseau ne correspond ou s'il n'a pas d'image top-down.
 */
export function resolveShipTopDownUrl(
  shipName: string | null | undefined,
  res: Res = "l",
): string | null {
  if (!shipName) return null;
  const key = `${shipName.toLowerCase()}|${res}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const idx = getIndex();
  const store = (url: string | null): string | null => {
    cache.set(key, url);
    return url;
  };

  // 1. Alias connus.
  const alias = STARJUMP_ALIASES[shipName];
  if (alias) {
    const e = idx.get(alias.toLowerCase());
    if (e) return store(buildUrl(e, res));
  }

  // 2. Correspondance exacte sur fleetview.
  const input = shipName.toLowerCase().trim();
  const exact = idx.get(input);
  if (exact) return store(buildUrl(exact, res));

  // 3. Sous-chaîne (on ignore les fleetviews trop courts).
  for (const [fv, e] of idx) {
    if (fv.length < 4) continue;
    if (input.includes(fv) || fv.includes(input)) return store(buildUrl(e, res));
  }

  // 4. Levenshtein (noms normalisés, seuil ≤ 3).
  const normInput = normalizeName(shipName);
  let best = Infinity;
  let bestE: Entry | null = null;
  for (const [fv, e] of idx) {
    const d = levenshtein(normInput, normalizeName(fv));
    if (d < best) {
      best = d;
      bestE = e;
    }
  }
  if (best <= 3 && bestE) return store(buildUrl(bestE, res));

  return store(null);
}
