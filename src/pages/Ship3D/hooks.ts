import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ship3dModelUrl, type Ship3DVariant } from "../../lib/ship3d";

// Télécharge (via Rust + cache sha256) la variante choisie → blob local prêt pour three.js.
export function useShipModel(variant: Ship3DVariant | null) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!variant) {
      setBlobUrl(null);
      setLoading(false);
      return;
    }
    let obj: string | null = null;
    let cancelled = false;
    setBlobUrl(null);
    setLoading(true);
    invoke<ArrayBuffer>("get_ship_model", { url: ship3dModelUrl(variant), sha256: variant.sha256 ?? null })
      .then((buf) => {
        if (cancelled) return;
        obj = URL.createObjectURL(new Blob([buf], { type: "model/gltf-binary" }));
        setBlobUrl(obj);
      })
      .catch(() => {
        /* échec réseau → on reste sur le blockout */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      if (obj) URL.revokeObjectURL(obj);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant?.modelUrl, variant?.sha256]);
  return { blobUrl, loading };
}
