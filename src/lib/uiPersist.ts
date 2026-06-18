import { useCallback, useState } from "react";

// Persistance d'état UI à travers la navigation. Adossé à sessionStorage (et NON à une Map
// module-level) : survit au démontage/remontage des pages par le routeur, ET au HMR de Vite
// en dev (une Map module serait vidée à chaque hot-reload). Réinitialisé au redémarrage de
// l'app (nouvelle session de webview). À réserver aux onglets / recherches / filtres — pas
// aux données chargées. Les valeurs doivent être sérialisables JSON.
const PREFIX = "ui:";

function read<T>(key: string, initial: T): T {
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    return raw != null ? (JSON.parse(raw) as T) : initial;
  } catch {
    return initial;
  }
}

function write<T>(key: string, value: T) {
  try {
    sessionStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* quota / valeur non sérialisable → on ignore (best-effort) */
  }
}

/** Comme useState, mais la valeur est mémorisée sous `key` et restaurée au remontage. */
export function usePersistentState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => read(key, initial));
  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const val =
          typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        write(key, val);
        return val;
      });
    },
    [key],
  );
  return [value, set] as const;
}

/** Écrit directement une valeur persistée (ex. pour appliquer un deep-link). */
export function setPersisted<T>(key: string, value: T) {
  write(key, value);
}
