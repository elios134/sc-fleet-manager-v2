// Images des fonds (séparées des données pour garder backgrounds.ts testable sans Vite).
import vortex from "../../../assets/bg/vortex.jpg";
import aurora from "../../../assets/bg/aurora.jpg";
import constellation from "../../../assets/bg/constellation.jpg";
import cutlass from "../../../assets/bg/cutlass.jpg";

export const BACKGROUND_IMAGES: Record<string, string> = { vortex, aurora, constellation, cutlass };

/** Repli sans WebGL : l'image fixe, cadrée sur son point d'intérêt. */
export function fallbackCss(id: string, focus: [number, number]): string {
  return `#0a0a0f url(${BACKGROUND_IMAGES[id]}) ${(focus[0] * 100).toFixed(1)}% ${((1 - focus[1]) * 100).toFixed(1)}% / cover no-repeat`;
}
