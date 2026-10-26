// Feu vert de l'animation du fond, commun aux deux fonds : visible, réglage activé, sans
// « réduire les animations » et hors partie (Game.log sondé toutes les 15 s).
import { useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { shouldAnimate } from "./animate";

const LOG_POLL_MS = 15_000;
type GameLogStatus = { logAgeSecs: number | null };

/** Renvoie une fonction stable à appeler à chaque image : faut-il animer maintenant ? */
export function useAnimationGate(enabled: boolean): () => boolean {
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const logAge = useRef<number | null>(null);

  useEffect(() => {
    const pollLog = () => {
      if (!enabledRef.current) return; // fond coupé : inutile de sonder le Game.log
      invoke<GameLogStatus>("get_gamelog_status")
        .then((s) => { logAge.current = s.logAgeSecs ?? null; })
        .catch(() => { logAge.current = null; });
    };
    pollLog();
    const poll = window.setInterval(pollLog, LOG_POLL_MS);
    return () => window.clearInterval(poll);
  }, []);

  return useCallback(
    () =>
      shouldAnimate({
        hidden: document.hidden,
        reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        enabled: enabledRef.current,
        logAgeSecs: logAge.current,
      }),
    [],
  );
}
