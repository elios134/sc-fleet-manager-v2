// Synchro automatique au lancement (spec docs/specs/2026-11-14-synchro-auto.md) — logique pure.
// Prix UEX à chaque lancement ; wiki et cargo une fois par mise à jour de Star Citizen installée.

export type AutoSyncSource = "wiki" | "cargo" | "uex";
type PatchSource = "wiki" | "cargo";
export type PatchStatusKind = "up_to_date" | "patch_detected" | "unknown";

/** AppMeta : « 0 » = éteint, sinon allumé (défaut). */
export const AUTO_SYNC_ENABLED_KEY = "autoSync.enabled";
/** AppMeta : dernier changenum synchronisé avec succès, par source (`autoSync.changenum.wiki`). */
export const AUTO_SYNC_CHANGENUM_PREFIX = "autoSync.changenum.";
/** AppMeta : dernière synchro de patch réussie, JSON `{ version, at }`. */
export const AUTO_SYNC_LAST_KEY = "autoSync.last";

export function isAutoSyncEnabled(raw: string | null): boolean {
  return raw !== "0";
}

export interface AutoSyncInput {
  /** Changenum du jeu installé ; null = jeu introuvable ou manifeste illisible. */
  installedChangenum: number | null;
  /** Statut des données du wiki face au jeu installé (get_patch_status). */
  patchStatus: PatchStatusKind;
  /** Dernier changenum réussi par source ; null = jamais (première fois). */
  done: Record<PatchSource, number | null>;
}

export interface AutoSyncPlan {
  /** Sources à synchroniser, dans l'ordre obligatoire wiki → cargo → uex. */
  sources: AutoSyncSource[];
  /** Sources dont on pose le marqueur sans synchroniser (première fois, données déjà à jour). */
  seed: PatchSource[];
  /** Vrai si une source de patch est synchronisée (déclenche la notification de fin). */
  patch: boolean;
}

export function planAutoSync({ installedChangenum, patchStatus, done }: AutoSyncInput): AutoSyncPlan {
  const sources: AutoSyncSource[] = [];
  const seed: PatchSource[] = [];
  if (installedChangenum != null) {
    for (const s of ["wiki", "cargo"] as const) {
      const last = done[s];
      if (last === installedChangenum) continue;
      if (last != null || patchStatus === "patch_detected") sources.push(s);
      else seed.push(s);
    }
  }
  const patch = sources.length > 0;
  sources.push("uex");
  return { sources, seed, patch };
}
