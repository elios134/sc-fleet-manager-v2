// État de vue de la carte (logique pure, testée) : niveau, sélection, POI, fil d'Ariane, calques.
import { SYSTEM_NAMES, safeName, type StarmapBodyItem } from "./starmapData";

export type View =
  | { level: "galaxy" }
  | { level: "system"; systemId: string }
  | { level: "object"; systemId: string; bodyId: string };
export type ViewState = { view: View; selectedId: string | null; poi: string | null };
export type ViewAction =
  | { type: "select"; body: StarmapBodyItem }
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
      const keep = s.view.level !== "galaxy" && s.view.systemId === sys;
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

export type Crumb = { label: string; level: "galaxy" | "system" | "object" | "poi" };

export function crumbsOf(s: ViewState, bodies: StarmapBodyItem[]): Crumb[] {
  const out: Crumb[] = [{ label: "GALAXIE", level: "galaxy" }];
  if (s.view.level === "galaxy") return out;
  out.push({ label: SYSTEM_NAMES[s.view.systemId.toLowerCase()] ?? s.view.systemId.toUpperCase(), level: "system" });
  if (s.view.level === "object") {
    const id = s.view.bodyId;
    const body = bodies.find((b) => b.id === id);
    if (body) out.push({ label: safeName(body).toUpperCase(), level: "object" });
    if (s.poi) out.push({ label: s.poi, level: "poi" });
  }
  return out;
}

export type LayerKey = "stations" | "jumps" | "belts" | "moons" | "poi";
export type Layers = Record<LayerKey, boolean>;
export const DEFAULT_LAYERS: Layers = { stations: true, jumps: true, belts: true, moons: true, poi: true };
