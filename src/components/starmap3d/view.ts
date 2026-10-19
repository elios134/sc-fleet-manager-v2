// État de vue de la carte (logique pure, testée) : niveau, sélection, POI, fil d'Ariane, calques.
import { SYSTEM_NAMES, safeName, type StarmapBodyItem } from "./starmapData";

export type View =
  | { level: "galaxy" }
  | { level: "system"; systemId: string }
  | { level: "object"; systemId: string; bodyId: string };
export type ViewState = { view: View; selectedId: string | null; poi: string | null };
export type ViewAction =
  | { type: "select"; body: StarmapBodyItem; childOfFocus?: boolean } // childOfFocus : enfant du corps de la vue globe
  | { type: "approach"; body: StarmapBodyItem }
  | { type: "poi"; name: string }
  | { type: "crumb"; level: "galaxy" | "system" | "object" }
  | { type: "system"; systemId: string }
  | { type: "clear" };

const canApproach = (b: StarmapBodyItem) => b.navIcon === "Planet" || b.navIcon === "Moon";

export function reduceView(s: ViewState, a: ViewAction): ViewState {
  switch (a.type) {
    case "approach":
      if (!canApproach(a.body)) return s;
      return { view: { level: "object", systemId: a.body.systemName, bodyId: a.body.id }, selectedId: a.body.id, poi: null };
    case "select": {
      const sys = a.body.systemName;
      if (s.selectedId === a.body.id && s.view.level === "system" && canApproach(a.body)) {
        return reduceView(s, { type: "approach", body: a.body });
      }
      // Vue globe gardée seulement pour le corps focalisé ou l'un de ses enfants ; sinon la carte
      // resterait sur l'ancien globe pendant que la fiche montre un autre corps.
      const keep =
        s.view.level === "system"
          ? s.view.systemId === sys
          : s.view.level === "object" && s.view.systemId === sys && (s.view.bodyId === a.body.id || a.childOfFocus === true);
      return { view: keep ? s.view : { level: "system", systemId: sys }, selectedId: a.body.id, poi: null };
    }
    case "poi":
      return s.view.level === "object" ? { ...s, poi: a.name } : s;
    case "crumb":
      if (a.level === "galaxy") return { view: { level: "galaxy" }, selectedId: null, poi: null };
      if (s.view.level === "galaxy") return s;
      if (a.level === "system") return { view: { level: "system", systemId: s.view.systemId }, selectedId: s.selectedId, poi: null };
      return { ...s, poi: null };
    case "system":
      return { view: { level: "system", systemId: a.systemId }, selectedId: null, poi: null };
    case "clear":
      return s.selectedId === null && s.poi === null ? s : { ...s, selectedId: null, poi: null };
  }
}

/** `selection` : corps choisi dans le globe d'un autre (lune) — non cliquable, comme `poi`. */
export type Crumb = { label: string; level: "galaxy" | "system" | "object" | "selection" | "poi" };

export function crumbsOf(s: ViewState, bodies: StarmapBodyItem[]): Crumb[] {
  const out: Crumb[] = [{ label: "GALAXIE", level: "galaxy" }];
  if (s.view.level === "galaxy") return out;
  out.push({ label: SYSTEM_NAMES[s.view.systemId.toLowerCase()] ?? s.view.systemId.toUpperCase(), level: "system" });
  if (s.view.level === "object") {
    const id = s.view.bodyId;
    const body = bodies.find((b) => b.id === id);
    if (body) out.push({ label: safeName(body).toUpperCase(), level: "object" });
    const sel = s.selectedId && s.selectedId !== id ? bodies.find((b) => b.id === s.selectedId) : undefined;
    if (sel) out.push({ label: safeName(sel).toUpperCase(), level: "selection" });
    if (s.poi) out.push({ label: s.poi, level: "poi" });
  }
  return out;
}

export type LayerKey = "stations" | "jumps" | "belts" | "moons" | "poi";
export type Layers = Record<LayerKey, boolean>;
export const DEFAULT_LAYERS: Layers = { stations: true, jumps: true, belts: true, moons: true, poi: true };

/** Vol caméra demandé dans une scène donnée (`key` = clé de scène du Canvas). */
export type KeyedFocus = { pos: [number, number, number]; dist: number; nonce: number; dir?: [number, number, number]; key: string };

/** Un vol n'est rejoué que dans la scène qui l'a demandé (le Canvas est remonté à chaque
 *  changement de vue : un vol d'une autre scène viserait de mauvaises coordonnées). */
export function focusFor<T extends { key: string }>(f: T | null, sceneKey: string): T | null {
  return f && f.key === sceneKey ? f : null;
}

/** Facteur de distance du vol à la sélection d'un corps (scène ou rail), ou null : pas de vol
 *  pour le corps déjà au centre de la vue globe. */
export function selectionFlight(level: View["level"], selectedId: string | null, focusId: string | null): number | null {
  if (!selectedId || level === "galaxy") return null;
  if (level === "object" && selectedId === focusId) return null;
  return 7;
}
