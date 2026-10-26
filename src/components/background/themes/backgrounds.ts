// Galerie des fonds de l'app (données pures, testées) : le Vortex cosmique (image dont le
// tourbillon tourne, shader.ts) et le Ciel étoilé (étoiles qui dérivent sur le fond teinté).

export type BackgroundId = "vortex" | "stars";

export type BackgroundDef = {
  id: BackgroundId;
  nameKey: string;
  /** Sous-titre de la vignette (ce qui bouge). */
  hintKey: string;
};

export const DEFAULT_BACKGROUND: BackgroundId = "vortex";

export const BACKGROUNDS: BackgroundDef[] = [
  { id: "vortex", nameKey: "settings.hud.bg.vortex", hintKey: "settings.hud.bgSwirl" },
  { id: "stars", nameKey: "settings.hud.bg.stars", hintKey: "settings.hud.bgDrift" },
];

/** Image du vortex : point gardé dans le cadre, tourbillon (cœur, rayon d'influence en hauteur
 *  d'image, ellipse, amplitude en rad par cycle). Coordonnées en uv, origine en bas à gauche. */
export const VORTEX = { focus: [0.506, 0.56], core: [0.506, 0.56], radius: 0.9, squash: [1, 0.85], amp: 0.55 } as const;

/** Fond choisi (id enregistré) ; inconnu, retiré ou absent → vortex. */
export function backgroundById(id: string | null | undefined): BackgroundDef {
  return BACKGROUNDS.find((b) => b.id === id) ?? BACKGROUNDS[0]!;
}
