import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

export type AppSettings = {
  accentColor: string;
  density: string;
  animationsEnabled: number;
  hudGlowIntensity: number;
  animatedStarsBg?: number;
  highContrastMode?: number;
  [key: string]: unknown;
};

export const DEFAULT_ACCENT = "#6366f1";
export const DEFAULT_ANIMATIONS = 1;
export const DEFAULT_HUD_INTENSITY = 75;

/* ────────────────────────── Dérivation de palette ──────────────────────────
 * Port fidèle de V1 (HudCustomizationContext deriveAmberPalette / hexToHsl /
 * hslToHex). À partir de la couleur d'accent, on dérive toute la famille de
 * tokens pour que la DA entière se reteinte (thèmes constructeurs).
 */

function hexToRgb(hex: string): string {
  const c = hex.replace("#", "");
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return "99,102,241";
  return `${r},${g},${b}`;
}

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const c = hex.replace("#", "");
  const r = parseInt(c.slice(0, 2), 16) / 255;
  const g = parseInt(c.slice(2, 4), 16) / 255;
  const b = parseInt(c.slice(4, 6), 16) / 255;
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return { h: 239, s: 84, l: 67 };
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s: s * 100, l: l * 100 };
}

function hslToHex(h: number, s: number, l: number): string {
  const sat = Math.max(0, Math.min(100, s)) / 100;
  const lig = Math.max(0, Math.min(100, l)) / 100;
  const cc = (1 - Math.abs(2 * lig - 1)) * sat;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = cc * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) { r = cc; g = x; }
  else if (hp < 2) { r = x; g = cc; }
  else if (hp < 3) { g = cc; b = x; }
  else if (hp < 4) { g = x; b = cc; }
  else if (hp < 5) { r = x; b = cc; }
  else { r = cc; b = x; }
  const m = lig - cc / 2;
  const toByte = (n: number) =>
    Math.round((n + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toByte(r)}${toByte(g)}${toByte(b)}`;
}

function deriveAmberPalette(hex: string): {
  amber: string;
  amberBright: string;
  copper: string;
  copperDeep: string;
  gold: string;
} {
  const { h, s, l } = hexToHsl(hex);
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  return {
    amber: hex,
    amberBright: hslToHex(h, s, clamp(l + 8, 0, 92)),
    copper: hslToHex(h, clamp(s - 8, 40, 100), clamp(l - 18, 14, 100)),
    copperDeep: hslToHex(h, clamp(s - 4, 40, 100), clamp(l - 38, 8, 100)),
    gold: hslToHex(h, clamp(s - 18, 30, 100), clamp(l - 5, 0, 92)),
  };
}

/**
 * Applique la couleur d'accent ET toute la famille de tokens dérivés (--accent-muted,
 * --amber/--amber-bright/--copper/--copper-deep/--gold, --accent-blue), pour que la DA
 * entière se reteinte depuis l'accent. NB : les couleurs codées en dur (hex) dans
 * certains écrans ne suivent pas (lot de conversion séparé).
 */
export function applyAccent(color: string): void {
  const root = document.documentElement;
  const rgb = hexToRgb(color);
  const p = deriveAmberPalette(color);

  root.style.setProperty("--accent", color);
  root.style.setProperty("--accent-muted", `rgba(${rgb},0.20)`);
  // --accent-foreground reste blanc (lisible sur l'accent) — non dérivé.

  root.style.setProperty("--amber", p.amber);
  root.style.setProperty("--amber-bright", p.amberBright);
  root.style.setProperty("--copper", p.copper);
  root.style.setProperty("--copper-deep", p.copperDeep);
  root.style.setProperty("--gold", p.gold);
  root.style.setProperty("--amber-muted", `rgba(${rgb},0.20)`);

  // Legacy (parité V1).
  root.style.setProperty("--accent-blue", color);

  // Thème général niveau L : glow du fond (Layout) teinté depuis l'accent. Alphas
  // faibles (~0.15 / ~0.10) pour rester discret ; glow-2 = teinte voisine (+25°)
  // pour conserver le dégradé deux-tons (rappel indigo→violet d'origine). Les
  // surfaces/textes ne sont PAS touchés.
  const { h, s, l } = hexToHsl(color);
  const glow2Rgb = hexToRgb(hslToHex(h + 25, s, l));
  root.style.setProperty("--bg-glow-1", `rgba(${rgb},0.15)`);
  root.style.setProperty("--bg-glow-2", `rgba(${glow2Rgb},0.10)`);
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
