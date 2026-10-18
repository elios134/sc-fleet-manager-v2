// Hook d'état de la carte : vue + sélection + POI (reduceView), calques persistés, LOD et vol caméra.
import { useCallback, useReducer, useRef, useState } from "react";
import { usePersistentState } from "../../lib/uiPersist";
import { DEFAULT_LAYERS, reduceView, type LayerKey, type Layers, type ViewAction, type ViewState } from "./view";
import type { FocusTarget } from "./CameraFocus";
import type { Vec3 } from "./placement";

export type Lod = "far" | "body" | "surface";

export type StarmapNav = {
  state: ViewState;
  dispatch: (a: ViewAction) => void;
  layers: Layers;
  toggleLayer: (k: LayerKey) => void;
  lod: Lod;
  setLod: (l: Lod) => void;
  camFocus: FocusTarget | null;
  focusOn: (pos: Vec3, radius: number, distFactor?: number) => void;
  clearFocus: () => void;
};

export function useStarmapView(initialSystem: string): StarmapNav {
  const [state, dispatch] = useReducer(reduceView, {
    view: { level: "system", systemId: initialSystem },
    selectedId: null,
    poi: null,
  });
  const [stored, setStored] = usePersistentState<Partial<Layers>>("starmap.layers", DEFAULT_LAYERS);
  // Fusion avec les défauts : une clé ajoutée (ex. « moons ») reste active pour un ancien réglage.
  const layers: Layers = { ...DEFAULT_LAYERS, ...stored };
  const toggleLayer = (k: LayerKey) => setStored((prev) => ({ ...DEFAULT_LAYERS, ...prev, [k]: !({ ...DEFAULT_LAYERS, ...prev })[k] }));
  const [lod, setLod] = useState<Lod>("far");
  const [camFocus, setCamFocus] = useState<FocusTarget | null>(null);
  const nonce = useRef(0);
  // Vol caméra animé vers une cible ; distance ∝ rayon visuel.
  const focusOn = useCallback((pos: Vec3, radius: number, distFactor = 7) => {
    const r = radius || 4;
    setCamFocus({ pos, dist: Math.max(r * distFactor, distFactor > 3 ? 16 : r * 1.6), nonce: ++nonce.current });
  }, []);
  const clearFocus = useCallback(() => setCamFocus(null), []);
  return { state, dispatch, layers, toggleLayer, lod, setLod, camFocus, focusOn, clearFocus };
}
