// État de « Où est mon… ? » : recherche, catégorie, recherches récentes (localStorage
// `inventory.recent`) et objet sélectionné, avec ses lieux rattachés à la carte.
import { useEffect, useMemo, useState } from "react";
import { positionBody } from "../../../components/starmap3d/panel";
import type { MapContext } from "../../../components/starmap3d/useMapContext";
import type { StarmapBodyItem } from "../../../components/starmap3d/starmapData";
import type { InvState, ItemMeta } from "../types";
import { pushRecent, searchItems, type InvFilter, type ItemPlace } from "../lib/search";

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
  const [selected, setSelected] = useState<string | null>(null);
  const active = query.trim() !== "" || filter !== "all";
  const hits = useMemo(() => (active ? searchItems(state, meta, query, filter) : []), [active, state, meta, query, filter]);
  const hit = hits.find((h) => h.classe === selected) ?? hits[0] ?? null;

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
  const places = useMemo<PlacedItem[]>(
    () => (hit?.places ?? []).map((p) => ({ ...p, body: p.key === "MOI" ? here : positionBody(p.raw, bodies) })),
    [hit, bodies, here],
  );
  return { query, setQuery, filter, setFilter, recent, active, hits, hit, select: setSelected, places };
}
export type WhereIs = ReturnType<typeof useWhereIs>;
