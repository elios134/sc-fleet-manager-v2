import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/* Panier d'achat du Catalogue : liste persistée (AppMeta "catalogue.cart") d'items que
   l'utilisateur veut acheter. `price` = prix indicatif le moins cher connu au moment de
   l'ajout (sert au total « à partir de »). */

export type CartItem = { key: string; idItem?: number; uuid?: string; name: string; price?: number };

const KEY = "catalogue.cart";

function save(items: CartItem[]) {
  void invoke("set_app_meta", { key: KEY, value: JSON.stringify(items) }).catch(() => {});
}

export function useCart() {
  const [items, setItems] = useState<CartItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    invoke<string | null>("get_app_meta", { key: KEY })
      .then((raw) => {
        if (!alive || !raw) return;
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) setItems(parsed);
        } catch {
          /* cache illisible → panier vide */
        }
      })
      .catch(() => {})
      .finally(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, []);

  const add = useCallback((it: CartItem) => {
    setItems((cur) => {
      if (cur.some((x) => x.key === it.key)) return cur;
      const next = [...cur, it];
      save(next);
      return next;
    });
  }, []);

  const remove = useCallback((key: string) => {
    setItems((cur) => {
      const next = cur.filter((x) => x.key !== key);
      save(next);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setItems([]);
    save([]);
  }, []);

  const has = useCallback((key: string) => items.some((x) => x.key === key), [items]);

  return { items, add, remove, clear, has, loaded };
}
