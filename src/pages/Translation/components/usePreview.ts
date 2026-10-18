import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/** Aperçu « 3 clés témoin » d'un pack, chargé quand `enabled` passe à vrai (une seule fois par URL). */
export function usePreview(url: string, enabled: boolean): { rows: [string, string][] | null; error: string | null } {
  const [rows, setRows] = useState<[string, string][] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || rows || error) return;
    let cancelled = false;
    invoke<[string, string][]>("translation_preview", { url })
      .then((r) => { if (!cancelled) setRows(r); })
      .catch((e) => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, [url, enabled, rows, error]);
  return { rows, error };
}
