// Plan de fabrication d'un plan : quantité, possédé par ingrédient (saisie gardée dans le
// localStorage `crafting.owned.<ref>`, sinon inventaire Game.log), manque, et plan de minage
// (lieux par ingrédient manquant, méthode choisie, un lieu retenu) → itinéraire de la carte.
import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useNavigate } from "react-router";
import { useMapContext } from "../../../components/starmap3d/useMapContext";
import { itineraryFrom } from "../../../components/starmap3d/itinerary";
import { saveItineraryStops } from "../../../components/starmap3d/useItinerary";
import type { BlueprintDetail, MiningLocation } from "../types";
import { craftNeeds, ownedFromInventory, sortSpots, spotStop, type MineMethod, type MiningSpot } from "../lib/missing";

type Possessions = Record<string, Record<string, { qte: number }>>;
const ownedKey = (ref: string) => `crafting.owned.${ref}`;

function readOwned(ref: string): number | null {
  try {
    const v = localStorage.getItem(ownedKey(ref));
    return v == null ? null : Math.max(0, Number(v)) || 0;
  } catch {
    return null;
  }
}

export function useCraftPlan(detail: BlueprintDetail) {
  const map = useMapContext();
  const navigate = useNavigate();
  const [qty, setQtyState] = useState(1);
  const [method, setMethod] = useState<MineMethod>("roc");
  const [typed, setTyped] = useState<Record<string, number>>({});
  const [inventory, setInventory] = useState<Possessions>({});
  const [spots, setSpots] = useState<Record<string, MiningLocation[]>>({});
  const [picks, setPicks] = useState<Record<string, string>>({});
  const requested = useRef(new Set<string>());
  const ings = detail.ingredients;

  useEffect(() => {
    invoke<{ possessions: Possessions } | null>("inventory_state")
      .then((s) => setInventory(s?.possessions ?? {}))
      .catch(() => {});
  }, []);
  // Saisies déjà faites pour ces ingrédients (un plan peut en partager avec un autre).
  useEffect(() => {
    const t: Record<string, number> = {};
    for (const i of ings) {
      const v = readOwned(i.ingredientRef);
      if (v != null) t[i.ingredientRef] = v;
    }
    setTyped(t);
    setPicks({});
  }, [ings]);

  const owned = useMemo(() => {
    const o: Record<string, number> = {};
    for (const i of ings) o[i.ingredientRef] = typed[i.ingredientRef] ?? ownedFromInventory(i.ingredientName, inventory) ?? 0;
    return o;
  }, [ings, typed, inventory]);
  const needs = useMemo(() => craftNeeds(ings, qty, owned), [ings, qty, owned]);
  const missingRefs = needs.filter((n) => n.missing > 0).map((n) => n.ref).join("|");

  // Lieux de minage chargés une fois par ingrédient manquant (gardés pour toute la fiche).
  useEffect(() => {
    for (const ref of missingRefs ? missingRefs.split("|") : []) {
      if (requested.current.has(ref)) continue;
      requested.current.add(ref);
      invoke<MiningLocation[]>("get_ingredient_mining_locations", { ingredientRef: ref })
        .then((r) => setSpots((s) => ({ ...s, [ref]: r })))
        .catch(() => setSpots((s) => ({ ...s, [ref]: [] })));
    }
  }, [missingRefs]);

  const { bodies, hereStop, dist } = map;
  /** Lieux de minage des ingrédients manquants, triés ; seuls ceux qui se minent apparaissent. */
  const plan = useMemo(
    () =>
      needs
        .filter((n) => n.missing > 0 && (spots[n.ref]?.length ?? 0) > 0)
        .map((n) => {
          const list: (MiningSpot & { key: string })[] = spots[n.ref].map((s) => {
            const stop = spotStop(s, bodies);
            return { ...s, key: `${s.systemName}|${s.rawBodyKey}|${s.miningMethod}`, gm: stop && hereStop ? dist(hereStop, stop) : null };
          });
          const sorted = sortSpots(list, method) as typeof list;
          return { need: n, spots: sorted, picked: picks[n.ref] ?? sorted[0]?.key };
        }),
    [needs, spots, bodies, hereStop, dist, method, picks],
  );

  return {
    qty,
    setQty: (n: number) => setQtyState(Math.min(99, Math.max(1, Math.round(n) || 1))),
    needs,
    setOwned: (ref: string, n: number) => {
      const v = Math.max(0, n || 0);
      setTyped((t) => ({ ...t, [ref]: v }));
      try {
        localStorage.setItem(ownedKey(ref), String(v));
      } catch {
        /* stockage indisponible : la saisie reste en mémoire */
      }
    },
    method,
    setMethod,
    plan,
    pick: (ref: string, key: string) => setPicks((p) => ({ ...p, [ref]: key })),
    hasPosition: map.here != null,
    /** Remplace l'itinéraire de la carte par les lieux retenus (départ = position) et l'ouvre. */
    toMap: () => {
      const stops = plan.map((p) => {
        const s = p.spots.find((x) => x.key === p.picked);
        return s ? spotStop(s, bodies) : null;
      });
      saveItineraryStops(itineraryFrom(hereStop, stops, dist));
      navigate("/starmap", { state: { panel: "route" } });
    },
  };
}
export type CraftPlan = ReturnType<typeof useCraftPlan>;
