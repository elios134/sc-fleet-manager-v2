// Données de la fiche pour le corps sélectionné : commerce UEX, vaisseaux à acheter / louer,
// meilleure route au départ, inventaire Game.log. Chaque source est chargée indépendamment (une erreur n'en masque pas
// une autre) et mise en cache par corps tant que la page est ouverte.
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { StarmapBodyItem } from "./starmapData";
import { bestRouteFrom, inventoryAt, locationNames } from "./panel";
import { buildScopeTree } from "../../pages/Inventory/aggregate";
import type { InvState } from "../../pages/Inventory/types";
import type { BodyRef } from "../../pages/Inventory/resolve";
import type { CargoRoute } from "../../pages/CargoRoutes/types";

export type TradeLine = { commodity: string; price: number };
export type TerminalTrade = { id: number; terminal: string; location: string; lastModified: number | null; buys: TradeLine[]; sells: TradeLine[] };
export type ShipOffer = { vehicle: string; terminal: string; location: string; price: number };
export type ShipOffers = { buy: ShipOffer[]; rent: ShipOffer[] };
export type LocationData = {
  trade: TerminalTrade[];
  ships: ShipOffers;
  route: CargoRoute | null;
  routeShip: string | null;
  inventory: { name: string; count: number }[];
};

const EMPTY: LocationData = { trade: [], ships: { buy: [], rent: [] }, route: null, routeShip: null, inventory: [] };
const safe = <T,>(p: Promise<T>, fallback: T): Promise<T> => p.catch(() => fallback);

export function useLocationData(body: StarmapBodyItem | null, bodies: StarmapBodyItem[]): LocationData {
  const cache = useRef(new Map<string, LocationData>());
  // Moteur de routes : un seul calcul par ouverture de la page (pas un par corps sélectionné).
  const routesP = useRef<Promise<{ shipName: string; routes: CargoRoute[] } | null> | null>(null);
  const [data, setData] = useState<{ id: string | null; d: LocationData }>({ id: null, d: EMPTY });

  useEffect(() => {
    if (!body) return;
    const hit = cache.current.get(body.id);
    if (hit) {
      setData({ id: body.id, d: hit });
      return;
    }
    let cancelled = false;
    let acc: LocationData = EMPTY;
    let pending = 4; // commerce, vaisseaux, route, inventaire : en cache une fois les quatre arrivés
    const put = (part: Partial<LocationData>) => {
      acc = { ...acc, ...part };
      if (--pending === 0) cache.current.set(body.id, acc);
      if (!cancelled) setData({ id: body.id, d: acc });
    };
    setData({ id: body.id, d: EMPTY });
    const names = locationNames(body, bodies);

    const tradeP = safe(invoke<TerminalTrade[]>("starmap_location_trade", { names }), []);
    void tradeP.then((trade) => put({ trade }));
    void safe(invoke<ShipOffers>("starmap_location_ships", { names }), EMPTY.ships).then((ships) => put({ ships }));

    // Les routes nomment des terminaux (« TDD Orison ») : on cherche aussi sur les noms de
    // terminaux / lieux renvoyés par le commerce du corps.
    void Promise.all([
      (routesP.current ??= safe(invoke<{ shipName: string; routes: CargoRoute[] } | null>("get_dashboard_top_routes", { limit: 20 }), null)),
      tradeP,
    ]).then(([res, trade]) => {
      const all = [...names, ...trade.flatMap((t) => [t.terminal, t.location])];
      const route = res ? bestRouteFrom(res.routes, all) : null;
      put({ route, routeShip: route && res ? res.shipName : null });
    });

    void safe(invoke<InvState | null>("inventory_state"), null).then((state) => {
      if (!state) return put({});
      const refs: BodyRef[] = bodies.map((b) => ({
        name: b.name,
        system: b.systemName,
        parentBody: b.parentRef,
        navIcon: b.navIcon,
      }));
      put({ inventory: inventoryAt(buildScopeTree(state, refs), body.name) });
    });

    return () => {
      cancelled = true;
    };
  }, [body, bodies]);

  return body && data.id === body.id ? data.d : EMPTY;
}
