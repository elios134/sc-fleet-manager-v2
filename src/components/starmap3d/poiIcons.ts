import * as THREE from "three";

// Icônes POI procédurales par type (canvas), cache module. Aucun asset embarqué.
export type PoiKind =
  | "city" | "station" | "outpost" | "settlement" | "mining"
  | "comm" | "bunker" | "cave" | "wreck" | "misc";

/** Type brut VerseTime → famille d'icône. */
export function poiKind(type: string): PoiKind {
  const t = (type || "").toLowerCase();
  if (/mining|ore|harvest|scrap/.test(t)) return "mining";
  if (/comm/.test(t)) return "comm";
  if (/cave/.test(t)) return "cave";
  if (/bunker/.test(t)) return "bunker";
  if (/wreck|ruin/.test(t)) return "wreck";
  if (/city|landing|prison/.test(t)) return "city";
  if (/station|asteroid base|orbital/.test(t)) return "station";
  if (/outpost|depot|distribution/.test(t)) return "outpost";
  if (/settlement|operating/.test(t)) return "settlement";
  return "misc";
}

const cache = new Map<PoiKind, THREE.CanvasTexture>();

/** Texture canvas (cache module) : puce arrondie sombre + liseré cyan + glyphe du type. */
export function poiIconTexture(kind: PoiKind): THREE.CanvasTexture {
  const hit = cache.get(kind);
  if (hit) return hit;
  const S = 64;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const x = c.getContext("2d")!;
  const r = 14, w = S - 8, h = S - 8, a = 4, b = 4;
  x.beginPath();
  x.moveTo(a + r, b);
  x.arcTo(a + w, b, a + w, b + h, r);
  x.arcTo(a + w, b + h, a, b + h, r);
  x.arcTo(a, b + h, a, b, r);
  x.arcTo(a, b, a + w, b, r);
  x.closePath();
  x.fillStyle = "rgba(6,11,20,.92)";
  x.fill();
  x.lineWidth = 2.5;
  x.strokeStyle = "rgba(125,222,255,.9)";
  x.stroke();
  x.save();
  x.translate(32, 32);
  x.fillStyle = "#f1f7ff";
  x.strokeStyle = "#f1f7ff";
  x.lineWidth = 3;
  x.lineJoin = "round";
  x.lineCap = "round";
  switch (kind) {
    case "city":
      x.fillRect(-13, -2, 7, 14); x.fillRect(-3, -12, 7, 24); x.fillRect(7, -6, 7, 18);
      break;
    case "station":
      x.beginPath(); x.ellipse(0, 0, 14, 8, 0, 0, 7); x.stroke();
      x.beginPath(); x.arc(0, 0, 4.5, 0, 7); x.fill();
      break;
    case "outpost":
      x.beginPath(); x.moveTo(-12, -1); x.lineTo(0, -12); x.lineTo(12, -1); x.closePath(); x.fill();
      x.fillRect(-10, -1, 20, 13);
      break;
    case "mining":
      x.beginPath(); x.moveTo(-12, 12); x.lineTo(12, -12); x.stroke();
      break;
    case "comm":
      x.beginPath(); x.moveTo(0, 14); x.lineTo(0, -4); x.stroke();
      x.beginPath(); x.arc(0, -11, 9, -1.1, 1.1); x.stroke();
      break;
    case "bunker":
      x.beginPath(); x.moveTo(-13, 11); x.lineTo(-13, 1); x.arc(0, 1, 13, Math.PI, 0); x.lineTo(13, 11); x.closePath(); x.fill();
      break;
    case "cave":
      x.beginPath(); x.arc(0, 2, 11, Math.PI, 0); x.lineTo(9, 12); x.lineTo(-9, 12); x.closePath(); x.fill();
      break;
    case "wreck":
      x.beginPath(); x.moveTo(-13, -8); x.lineTo(-2, 2); x.lineTo(-7, 7); x.lineTo(6, 13); x.stroke();
      break;
    case "settlement":
      [-8, 8].forEach((cx) => {
        x.beginPath(); x.moveTo(cx - 7, -3); x.lineTo(cx, -12); x.lineTo(cx + 7, -3); x.closePath(); x.fill();
        x.fillRect(cx - 5, -3, 10, 14);
      });
      break;
    default:
      x.beginPath(); x.moveTo(0, -12); x.lineTo(12, 0); x.lineTo(0, 12); x.lineTo(-12, 0); x.closePath(); x.fill();
  }
  x.restore();
  const t = new THREE.CanvasTexture(c);
  t.minFilter = THREE.LinearFilter;
  cache.set(kind, t);
  return t;
}
