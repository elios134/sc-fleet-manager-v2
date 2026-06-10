import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

export type AppSettings = {
  accentColor: string;
  density: string;
  animationsEnabled: number;
  hudGlowIntensity: number;
  [key: string]: unknown;
};

export const DEFAULT_ACCENT = "#6366f1";
export const DEFAULT_ANIMATIONS = 1;
export const DEFAULT_HUD_INTENSITY = 75;

/** Applique la couleur d'accent au token CSS global `--accent`. */
export function applyAccent(color: string): void {
  document.documentElement.style.setProperty("--accent", color);
}

/** Charge les réglages au démarrage et restaure la couleur d'accent depuis la DB. */
export function useAppSettings(): void {
  useEffect(() => {
    let cancelled = false;
    invoke<AppSettings>("get_app_settings")
      .then((settings) => {
        if (cancelled) return;
        if (settings && typeof settings.accentColor === "string") {
          applyAccent(settings.accentColor);
        }
      })
      .catch(() => {
        /* silencieux : on garde l'accent par défaut du thème */
      });
    return () => {
      cancelled = true;
    };
  }, []);
}
