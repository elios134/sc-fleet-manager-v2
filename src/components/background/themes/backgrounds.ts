// Galerie des fonds de l'app (données pures, testées). Chaque fond = une image affichée telle
// quelle + une animation légère : tourbillon autour d'un cœur (amp > 0) ou dérive lente
// (panoramique + zoom doux, drift > 0). Coordonnées en uv de l'image, origine en bas à gauche.
export type BackgroundDef = {
  id: string;
  nameKey: string;
  /** Auteur de la capture (communauté), affiché en crédit. */
  author: string | null;
  /** Point gardé dans le cadre quand l'écran est plus étroit que l'image. */
  focus: [number, number];
  /** Tourbillon : cœur, rayon d'influence (en hauteur d'image), ellipse, amplitude (rad par cycle). */
  core: [number, number];
  radius: number;
  squash: [number, number];
  amp: number;
  /** Dérive lente (0 = aucune) : amplitude du panoramique / zoom. */
  drift: number;
};

export const DEFAULT_BACKGROUND = "vortex";

export const BACKGROUNDS: BackgroundDef[] = [
  { id: "vortex", nameKey: "settings.hud.bg.vortex", author: null, focus: [0.506, 0.56], core: [0.506, 0.56], radius: 0.9, squash: [1, 0.85], amp: 0.55, drift: 0 },
  { id: "aurora", nameKey: "settings.hud.bg.aurora", author: "inmuter", focus: [0.6, 0.5], core: [0.5, 0.5], radius: 0, squash: [1, 1], amp: 0, drift: 1 },
  { id: "constellation", nameKey: "settings.hud.bg.constellation", author: "Evenlease44", focus: [0.55, 0.55], core: [0.5, 0.5], radius: 0, squash: [1, 1], amp: 0, drift: 1 },
  { id: "cutlass", nameKey: "settings.hud.bg.cutlass", author: "damgot", focus: [0.5, 0.5], core: [0.5, 0.5], radius: 0, squash: [1, 1], amp: 0, drift: 1 },
];

/** Fond choisi (id enregistré) ; inconnu ou absent → vortex. */
export function backgroundById(id: string | null | undefined): BackgroundDef {
  return BACKGROUNDS.find((b) => b.id === id) ?? BACKGROUNDS[0];
}
