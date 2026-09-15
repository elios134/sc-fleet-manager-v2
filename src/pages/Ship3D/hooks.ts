import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ship3dModelUrl, type Ship3DVariant } from "../../lib/ship3d";
import { parseShipLights, type ShipLightDef } from "../../lib/ship3dLights";

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

// Sidecar lumières de la variante Visite (si publié dans l'index) : même canal que les .glb
// (téléchargement Rust anti-CORS + cache disque sha256). null tant que non chargé / absent —
// la Visite marche sans (éclairage générique seul), les lumières s'ajoutent quand elles arrivent.
export function useShipLights(variant: Ship3DVariant | null) {
  const [lights, setLights] = useState<ShipLightDef[] | null>(null);
  useEffect(() => {
    const ref = variant?.lights;
    if (!ref?.url) {
      setLights(null);
      return;
    }
    let cancelled = false;
    setLights(null);
    invoke<ArrayBuffer>("get_ship_model", { url: ship3dModelUrl({ modelUrl: ref.url }), sha256: ref.sha256 ?? null })
      .then((buf) => {
        if (cancelled) return;
        const parsed = parseShipLights(buf);
        setLights(parsed.length > 0 ? parsed : null);
      })
      .catch(() => {
        /* échec réseau → Visite sans lumières embarquées */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant?.lights?.url, variant?.lights?.sha256]);
  return lights;
}
