// Liste d'achats d'un vaisseau (une ligne par emplacement), gardée dans le localStorage
// sous `loadout.cart.<shipId>` : elle survit au redémarrage et suit le vaisseau affiché.
import { useEffect, useState } from "react";
import type { CartLine } from "../lib/shopping";

const keyOf = (shipId: number | null) => (shipId == null ? null : `loadout.cart.${shipId}`);

function load(key: string | null): CartLine[] {
  if (!key) return [];
  try {
    const v: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(v) ? v.filter((l): l is CartLine => typeof l?.slot === "string" && typeof l?.price === "number") : [];
  } catch {
    return [];
  }
}

export function useShoppingCart(shipId: number | null) {
  const key = keyOf(shipId);
  const [state, setState] = useState<{ key: string | null; lines: CartLine[] }>(() => ({ key, lines: load(key) }));
  // Autre vaisseau → on recharge sa propre liste.
  const lines = state.key === key ? state.lines : load(key);
  if (state.key !== key) setState({ key, lines });
  useEffect(() => {
    if (!state.key) return;
    try {
      localStorage.setItem(state.key, JSON.stringify(state.lines));
    } catch {
      /* stockage indisponible : la liste reste en mémoire */
    }
  }, [state]);
  const update = (f: (l: CartLine[]) => CartLine[]) => setState((s) => ({ ...s, lines: f(s.lines) }));
  return {
    lines,
    lineFor: (slot: string) => lines.find((l) => l.slot === slot) ?? null,
    /** Ajoute (ou remplace) l'achat d'un emplacement ; le même composant au même terminal le retire. */
    toggle: (line: CartLine) =>
      update((l) => {
        const cur = l.find((x) => x.slot === line.slot);
        const rest = l.filter((x) => x.slot !== line.slot);
        return cur && cur.className === line.className && cur.terminal === line.terminal ? rest : [...rest, line];
      }),
    remove: (slot: string) => update((l) => l.filter((x) => x.slot !== slot)),
    clear: () => update(() => []),
  };
}
export type ShoppingCart = ReturnType<typeof useShoppingCart>;
