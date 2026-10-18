import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type Preview = { key: string; rows: [string, string][] | null; error: string | null };

/** Aperçu « 3 clés témoin » d'un pack, chargé quand `enabled` passe à vrai (une seule fois par source).
 *  Avec `channelPath`, lu dans le global.ini installé sur ce canal (sans téléchargement). */
export function usePreview(url: string, enabled: boolean, channelPath?: string): { rows: [string, string][] | null; error: string | null } {
  const key = channelPath ? `local:${channelPath}|${url}` : url;
  const [state, setState] = useState<Preview>({ key, rows: null, error: null });
  const cur = state.key === key ? state : { key, rows: null, error: null };
  useEffect(() => {
    if (!enabled || cur.rows || cur.error) return;
    let cancelled = false;
    const call = channelPath
      ? invoke<[string, string][]>("translation_preview_installed", { channelPath })
      : invoke<[string, string][]>("translation_preview", { url });
    call
      .then((r) => { if (!cancelled) setState({ key, rows: r, error: null }); })
      .catch((e) => { if (!cancelled) setState({ key, rows: null, error: String(e) }); });
    return () => { cancelled = true; };
  }, [key, enabled, cur.rows, cur.error]);
  return { rows: cur.rows, error: cur.error };
}
