import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type Preview = { url: string; rows: [string, string][] | null; error: string | null };

/** Aperçu « 3 clés témoin » d'un pack, chargé quand `enabled` passe à vrai (une seule fois par URL). */
export function usePreview(url: string, enabled: boolean): { rows: [string, string][] | null; error: string | null } {
  const [state, setState] = useState<Preview>({ url, rows: null, error: null });
  const cur = state.url === url ? state : { url, rows: null, error: null };
  useEffect(() => {
    if (!enabled || cur.rows || cur.error) return;
    let cancelled = false;
    invoke<[string, string][]>("translation_preview", { url })
      .then((r) => { if (!cancelled) setState({ url, rows: r, error: null }); })
      .catch((e) => { if (!cancelled) setState({ url, rows: null, error: String(e) }); });
    return () => { cancelled = true; };
  }, [url, enabled, cur.rows, cur.error]);
  return { rows: cur.rows, error: cur.error };
}
