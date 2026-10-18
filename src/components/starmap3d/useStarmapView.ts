// Hook d'état de la carte : vue + sélection + POI (reduceView), calques persistés, LOD et vol caméra.
import { useCallback, useReducer, useRef, useState } from "react";
import { usePersistentState } from "../../lib/uiPersist";
import { DEFAULT_LAYERS, reduceView, type KeyedFocus, type LayerKey, type Layers, type ViewAction, type ViewState } from "./view";
import type { Vec3 } from "./placement";

export type Lod = "far" | "body" | "surface";

export type StarmapNav = {
  state: ViewState;
  dispatch: (a: ViewAction) => void;
  layers: Layers;
  toggleLayer: (k: LayerKey) => void;
  lod: Lod;
  setLod: (l: Lod) => void;
  camFocus: KeyedFocus | null;
  /** Vol caméra vers `pos`, demandé par la scène `key` (rejoué seulement dans celle-ci). */
  focusOn: (key: string, pos: Vec3, radius: number, distFactor?: number, dir?: Vec3) => void;
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
  const [camFocus, setCamFocus] = useState<KeyedFocus | null>(null);
  const nonce = useRef(0);
  // Vol caméra animé vers une cible ; distance ∝ rayon visuel.
  const focusOn = useCallback((key: string, pos: Vec3, radius: number, distFactor = 7, dir?: Vec3) => {
    const r = radius || 4;
    const dist = distFactor > 3 ? Math.max(r * distFactor, 16) : r * distFactor;
    setCamFocus({ pos, dist, nonce: ++nonce.current, dir, key });
  }, []);
  const clearFocus = useCallback(() => setCamFocus(null), []);
  return { state, dispatch, layers, toggleLayer, lod, setLod, camFocus, focusOn, clearFocus };
}
