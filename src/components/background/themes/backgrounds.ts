// Galerie des fonds de l'app (données pures, testées). Chaque fond = une image affichée telle
// quelle, sans zoom, animée par sa scène (shader.ts) ; le vortex tourne autour de son cœur
// (amp > 0). Coordonnées en uv de l'image, origine en bas à gauche.

/** Animation propre à chaque image ; l'index est passé tel quel au shader (uniform SCENE). */
export const SCENE_INDEX = { vortex: 0, aurora: 1, constellation: 2, cutlass: 3 } as const;
export type BackgroundScene = keyof typeof SCENE_INDEX;

export type BackgroundDef = {
  id: string;
  nameKey: string;
  scene: BackgroundScene;
  /** Auteur de la capture (communauté), affiché en crédit. */
  author: string | null;
  /** Point gardé dans le cadre quand l'écran est plus étroit que l'image. */
  focus: [number, number];
  /** Tourbillon : cœur, rayon d'influence (en hauteur d'image), ellipse, amplitude (rad par cycle). */
  core: [number, number];
  radius: number;
  squash: [number, number];
  amp: number;
};

export const DEFAULT_BACKGROUND = "vortex";

export const BACKGROUNDS: BackgroundDef[] = [
  { id: "vortex", nameKey: "settings.hud.bg.vortex", scene: "vortex", author: null, focus: [0.506, 0.56], core: [0.506, 0.56], radius: 0.9, squash: [1, 0.85], amp: 0.55 },
  { id: "aurora", nameKey: "settings.hud.bg.aurora", scene: "aurora", author: "inmuter", focus: [0.6, 0.5], core: [0.5, 0.5], radius: 0, squash: [1, 1], amp: 0 },
  { id: "constellation", nameKey: "settings.hud.bg.constellation", scene: "constellation", author: "Evenlease44", focus: [0.55, 0.55], core: [0.5, 0.5], radius: 0, squash: [1, 1], amp: 0 },
  { id: "cutlass", nameKey: "settings.hud.bg.cutlass", scene: "cutlass", author: "damgot", focus: [0.5, 0.5], core: [0.5, 0.5], radius: 0, squash: [1, 1], amp: 0 },
];

/** Fond choisi (id enregistré) ; inconnu ou absent → vortex. */
export function backgroundById(id: string | null | undefined): BackgroundDef {
  return BACKGROUNDS.find((b) => b.id === id) ?? BACKGROUNDS[0];
}
