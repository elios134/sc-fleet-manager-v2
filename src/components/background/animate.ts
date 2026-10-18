// Quand le fond animé doit-il tourner ? (logique pure, testée)

/** Game.log modifié il y a moins de ce délai ⇒ le jeu tourne. */
export const GAME_ACTIVE_SECS = 60;

export function isGameActive(logAgeSecs: number | null): boolean {
  return logAgeSecs != null && logAgeSecs < GAME_ACTIVE_SECS;
}

/** Anime seulement si visible, autorisé, sans « réduire les animations » et hors partie. */
export function shouldAnimate(o: {
  hidden: boolean;
  reducedMotion: boolean;
  enabled: boolean;
  logAgeSecs: number | null;
}): boolean {
  return !o.hidden && !o.reducedMotion && o.enabled && !isGameActive(o.logAgeSecs);
}
