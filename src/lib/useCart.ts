import { useCallback, useEffect, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";

/* Panier d'achat du Catalogue : liste persistée (AppMeta "catalogue.cart") d'items que
   l'utilisateur veut acheter. `price` = prix indicatif le moins cher connu au moment de
   l'ajout (sert au total « à partir de »).

   Store AU NIVEAU MODULE (et non état local par composant) : la puce Panier de l'en-tête
   et l'onglet Achetable partagent ainsi le MÊME panier et se mettent à jour ensemble. */

export type CartItem = { key: string; idItem?: number; uuid?: string; name: string; price?: number };

const KEY = "catalogue.cart";

let cartItems: CartItem[] = [];
let cartLoaded = false;
let hydrated = false; // n'hydrate qu'une fois (le 1er montage), quel que soit le nb d'abonnés
const subs = new Set<() => void>();
function emit() {
  subs.forEach((s) => s());
}
function setItems(next: CartItem[]) {
  cartItems = next;
  void invoke("set_app_meta", { key: KEY, value: JSON.stringify(next) }).catch(() => {});
  emit();
}

function hydrateOnce() {
  if (hydrated) return;
  hydrated = true;
  invoke<string | null>("get_app_meta", { key: KEY })
    .then((raw) => {
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) cartItems = parsed;
        } catch {
          /* cache illisible → panier vide */
        }
      }
    })
    .catch(() => {})
    .finally(() => {
      cartLoaded = true;
      emit();
    });
}

export function useCart() {
  const items = useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => cartItems,
  );
  const loaded = useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => cartLoaded,
  );

  useEffect(() => {
    hydrateOnce();
  }, []);

  const add = useCallback((it: CartItem) => {
    if (cartItems.some((x) => x.key === it.key)) return;
    setItems([...cartItems, it]);
  }, []);

  const remove = useCallback((key: string) => {
    setItems(cartItems.filter((x) => x.key !== key));
  }, []);

  const clear = useCallback(() => {
    setItems([]);
  }, []);

  const has = useCallback((key: string) => items.some((x) => x.key === key), [items]);

  return { items, add, remove, clear, has, loaded };
}
