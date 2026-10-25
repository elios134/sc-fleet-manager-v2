// Données de la fiche d'un article : descriptif Wiki (image, stats) et points de vente triés
// par prix. Rechargées à chaque changement d'article ; `onImage` remonte l'image Wiki trouvée.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PurchasePoint } from "./shared";

export type ItemLite = {
  idItem: number | null;
  uuid: string | null;
  name: string | null;
  section: string | null;
  category: string | null;
  companyName?: string | null;
  size?: string | null;
  imageUrl?: string | null;
};
type ItemStat = { name: string; value: string };
export type ItemWikiDetail = {
  available: boolean;
  description: string | null;
  manufacturer: string | null;
  typeLabel: string | null;
  subTypeLabel: string | null;
  size: number | null;
  grade: string | null;
  webUrl: string | null;
  imageUrl: string | null;
  stats: ItemStat[];
};

export function useItemDetail(item: ItemLite, onImage?: (uuid: string, url: string) => void) {
  const [detail, setDetail] = useState<ItemWikiDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [points, setPoints] = useState<PurchasePoint[] | null>(null);

  useEffect(() => {
    let alive = true;
    setPoints(null);
    setDetail(null);
    invoke<PurchasePoint[]>("get_item_purchase_points", { idItem: item.idItem, uuid: item.uuid })
      .then((p) => alive && setPoints(p))
      .catch(() => alive && setPoints([]));
    if (!item.uuid) return () => { alive = false; };
    setLoadingDetail(true);
    invoke<ItemWikiDetail>("get_item_wiki_detail", { uuid: item.uuid })
      .then((d) => {
        if (!alive) return;
        setDetail(d);
        if (d.imageUrl && item.uuid) onImage?.(item.uuid, d.imageUrl);
      })
      .catch(() => alive && setDetail(null))
      .finally(() => alive && setLoadingDetail(false));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.idItem, item.uuid]);

  return { detail, loadingDetail, points };
}
