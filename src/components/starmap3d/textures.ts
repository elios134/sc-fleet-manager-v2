import * as THREE from "three";

// Textures procédurales par type (canvas), générées une fois et mises en cache module
// (jamais dispose). Le type est dérivé du champ `appearance` RSI. Aucune texture réelle :
// clean-room, zéro asset embarqué.
export type TextureKind = "green" | "gas" | "brown" | "blue" | "rock";

export function textureKindFor(appearance: string | null | undefined): TextureKind {
  switch (appearance) {
    case "PLANET_GREEN":
      return "green";
    case "PLANET_GAS":
      return "gas";
    case "PLANET_BROWN":
      return "brown";
    case "PLANET_BLUE":
      return "blue";
    default:
      return "rock";
  }
}

const cache = new Map<TextureKind, THREE.CanvasTexture>();

function canvas(size = 512): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  return [c, c.getContext("2d")!];
}
function finish(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function blobs(
  x: CanvasRenderingContext2D,
  S: number,
  n: number,
  palette: string[],
  rMin: number,
  rMax: number,
  aMin: number,
  aMax: number,
) {
  for (let i = 0; i < n; i++) {
    const r = rMin + Math.pow(Math.random(), 2) * (rMax - rMin);
    x.globalAlpha = aMin + Math.random() * (aMax - aMin);
    x.fillStyle = palette[(Math.random() * palette.length) | 0];
    x.beginPath();
    x.arc(Math.random() * S, Math.random() * S, r, 0, 7);
    x.fill();
  }
  x.globalAlpha = 1;
}

function genGreen(S: number, x: CanvasRenderingContext2D) {
  x.fillStyle = "#1b4f7a";
  x.fillRect(0, 0, S, S); // océan
  blobs(x, S, 40, ["#3f7d4f", "#5a9a5e", "#6f8f4a", "#37663f"], 18, 70, 0.6, 0.95); // continents
  blobs(x, S, 120, ["#dfeaf0", "#c8d8e0"], 6, 22, 0.05, 0.18); // nuages
}
function genGas(S: number, x: CanvasRenderingContext2D) {
  const bands = ["#b58a64", "#c8a074", "#9c7a58", "#d8b488", "#8a6a4c"];
  const h = S / 22;
  for (let i = 0; i < 22; i++) {
    x.fillStyle = bands[i % bands.length];
    x.globalAlpha = 0.85;
    x.fillRect(0, i * h, S, h + 1);
  }
  x.globalAlpha = 1;
  const g = x.createRadialGradient(S * 0.62, S * 0.55, 4, S * 0.62, S * 0.55, S * 0.12);
  g.addColorStop(0, "#d98b5e");
  g.addColorStop(1, "rgba(217,139,94,0)");
  x.fillStyle = g;
  x.beginPath();
  x.ellipse(S * 0.62, S * 0.55, S * 0.13, S * 0.08, 0, 0, 7);
  x.fill();
}
function genBrown(S: number, x: CanvasRenderingContext2D) {
  x.fillStyle = "#7c5a3c";
  x.fillRect(0, 0, S, S);
  blobs(x, S, 220, ["#5a3f29", "#8a6a47", "#3f2c1d", "#9c7a52", "#6b4a30"], 6, 40, 0.1, 0.3);
}
function genBlue(S: number, x: CanvasRenderingContext2D) {
  const g = x.createLinearGradient(0, 0, 0, S);
  g.addColorStop(0, "#bfe2ef");
  g.addColorStop(0.5, "#5a93c4");
  g.addColorStop(1, "#2f5e86");
  x.fillStyle = g;
  x.fillRect(0, 0, S, S);
  blobs(x, S, 60, ["#e6f4fb", "#9fc8e0"], 8, 30, 0.08, 0.22);
}
function genRock(S: number, x: CanvasRenderingContext2D) {
  x.fillStyle = "#6a6056";
  x.fillRect(0, 0, S, S);
  blobs(x, S, 300, ["#7c7163", "#544b41", "#857a6b", "#3f382f", "#928679"], 4, 26, 0.06, 0.2);
  for (let j = 0; j < 90; j++) {
    const pr = 3 + Math.pow(Math.random(), 1.5) * 16;
    const px = Math.random() * S;
    const py = Math.random() * S;
    const rg = x.createRadialGradient(px, py, 0, px, py, pr);
    rg.addColorStop(0, "rgba(8,6,6,.55)");
    rg.addColorStop(1, "rgba(8,6,6,0)");
    x.fillStyle = rg;
    x.beginPath();
    x.arc(px, py, pr, 0, 7);
    x.fill();
  }
}

const GENERATORS: Record<TextureKind, (S: number, x: CanvasRenderingContext2D) => void> = {
  green: genGreen,
  gas: genGas,
  brown: genBrown,
  blue: genBlue,
  rock: genRock,
};

export function bodyTexture(kind: TextureKind): THREE.CanvasTexture {
  const hit = cache.get(kind);
  if (hit) return hit;
  const S = 512;
  const [c, x] = canvas(S);
  GENERATORS[kind](S, x);
  const t = finish(c);
  cache.set(kind, t);
  return t;
}

let starGlow: THREE.CanvasTexture | null = null;
export function starGlowTexture(): THREE.CanvasTexture {
  if (starGlow) return starGlow;
  const [c, x] = canvas(128);
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.18, "rgba(255,244,221,.9)");
  g.addColorStop(0.45, "rgba(255,200,120,.28)");
  g.addColorStop(1, "rgba(255,180,90,0)");
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  starGlow = finish(c);
  return starGlow;
}
