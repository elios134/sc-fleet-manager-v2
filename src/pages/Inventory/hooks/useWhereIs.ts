// État de « Où est mon… ? » : recherche, catégorie, recherches récentes (localStorage
// `inventory.recent`) ; lieux d'un objet rattachés à la carte.
import { useCallback, useEffect, useMemo, useState } from "react";
import { positionBody } from "../../../components/starmap3d/panel";
import type { MapContext } from "../../../components/starmap3d/useMapContext";
import type { StarmapBodyItem } from "../../../components/starmap3d/starmapData";
import type { InvState, ItemMeta } from "../types";
import { itemPlaces, pushRecent, searchItems, type InvFilter, type ItemPlace } from "../lib/search";

const RECENT_KEY = "inventory.recent";

function loadRecent(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 5) : [];
  } catch {
    return [];
  }
}

/** Lieu d'un objet avec son corps de la carte (la position du joueur pour « sur moi »). */
export type PlacedItem = ItemPlace & { body: StarmapBodyItem | null };

export function useWhereIs(state: InvState, meta: Record<string, ItemMeta>, map: MapContext) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<InvFilter>("all");
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const active = query.trim() !== "" || filter !== "all";
  const hits = useMemo(() => (active ? searchItems(state, meta, query, filter) : []), [active, state, meta, query, filter]);

  // La recherche entre dans les récentes quand l'utilisateur s'arrête de taper.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const id = window.setTimeout(() => setRecent((r) => pushRecent(r, q)), 1200);
    return () => window.clearTimeout(id);
  }, [query]);
  useEffect(() => {
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
    } catch {
      /* stockage indisponible : les récentes restent en mémoire */
    }
  }, [recent]);

  const { bodies, here } = map;
  const allPlaces = useMemo(() => itemPlaces(state), [state]);
  const placesOf = useCallback(
    (classe: string): PlacedItem[] =>
      (allPlaces.get(classe) ?? []).map((p) => ({ ...p, body: p.key === "MOI" ? here : positionBody(p.raw, bodies) })),
    [allPlaces, bodies, here],
  );
  return { query, setQuery, filter, setFilter, recent, active, hits, placesOf };
}
export type WhereIs = ReturnType<typeof useWhereIs>;
