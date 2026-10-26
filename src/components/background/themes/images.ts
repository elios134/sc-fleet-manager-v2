// Image du Vortex cosmique (séparée des données pour garder backgrounds.ts testable sans Vite).
import vortex from "../../../assets/bg/vortex.jpg";
import { VORTEX } from "./backgrounds";

export const VORTEX_IMAGE = vortex;

/** Repli sans WebGL : l'image fixe, cadrée sur son point d'intérêt. */
export const VORTEX_FALLBACK_CSS = `#0a0a0f url(${vortex}) ${(VORTEX.focus[0] * 100).toFixed(1)}% ${((1 - VORTEX.focus[1]) * 100).toFixed(1)}% / cover no-repeat`;
