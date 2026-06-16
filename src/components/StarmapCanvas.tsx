import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";

// Carte galactique — port fidèle du StarmapCanvas V1 (placement + interactions).
// LOT 2 : niveaux GALAXIE + SYSTÈME. Les niveaux PLANÈTE + SPHÈRE (globe fake-3D,
// rotation, images get_starmap_body_image) sont prévus au LOT 3 — seuils + level()
// laissés en place pour les brancher sans refonte.

export type StarmapBodyItem = {
  id: string;
  recordName: string;
  systemName: string;
  navIcon: string;
  name: string;
  description: string | null;
  size: number | null;
  parentRef: string | null;
  hideInStarmap: boolean;
  showOrbitLine: boolean;
  orbitOrder: number | null;
  source: string;
  lastSyncedAt: string | null;
  posX: number | null;
  posY: number | null;
  posZ: number | null;
};

interface Cam {
  x: number;
  y: number;
  z: number;
}
type ZoomLevel = "galaxy" | "system" | "planet" | "sphere";

interface HitTarget {
  x: number;
  y: number;
  r: number;
  wx: number;
  wy: number;
  z: number;
  systemId?: string;
}

interface BodyLayout {
  body: StarmapBodyItem;
  wx: number;
  wy: number;
  rv: number;
  ring: number;
  ang: number;
  children: BodyLayout[];
}

interface SystemLayout {
  id: string;
  name: string;
  color: string;
  star: BodyLayout | null;
  planets: BodyLayout[];
  moons: BodyLayout[];
  pois: BodyLayout[];
  gx: number;
  gy: number;
}

// ── Constantes (port V1) ──
const TILT = 0.46;
const MINZ = 0.18;
const MAXZ = 20;
const GLX_THRESHOLD = 0.42; // en dessous → galaxie
const PLN_THRESHOLD = 3.6; // au-dessus → planète (LOT 3)
const SPHERE_THRESHOLD = 9.0; // au-dessus → sphère (LOT 3)

const FIRST_RING = 88;
const RING_STEP = 52;
const MOON_ANGLE_SEP = 0.4;
const LAGRANGE_RING = 78;
const LABEL_NUDGE_DIST = 22;

const WHEEL_SENS = 0.0012;
const WHEEL_FACTOR_MIN = 0.8;
const WHEEL_FACTOR_MAX = 1.25;

const GALAXY_POSITIONS: Record<string, { gx: number; gy: number }> = {
  stanton: { gx: 0, gy: 0 },
  pyro: { gx: 520, gy: -120 },
  nyx: { gx: -360, gy: 300 },
};

const GALAXY_LINKS: Array<[string, string]> = [
  ["stanton", "pyro"],
  ["stanton", "nyx"],
  ["pyro", "nyx"],
];

const SYSTEM_COLORS: Record<string, string> = {
  stanton: "#f5a623",
  pyro: "#ff4422",
  nyx: "#28c8f0",
};

const SYSTEM_NAMES: Record<string, string> = {
  stanton: "STANTON",
  pyro: "PYRO",
  nyx: "NYX",
};

// Couleurs holographiques par corps (scopées à la carte, pas la DA app).
const BODY_COLORS: Record<string, string> = {
  stantonstar: "#ffe87c",
  pyrostar: "#ff5500",
  nyxstar: "#28c8f0",
  stanton1: "#3ecfbf",
  stanton2: "#f0c030",
  stanton3: "#3a8eff",
  stanton4: "#7de4f8",
  pyro1: "#ff6040",
  pyro2: "#ff2000",
  pyro3: "#ff8860",
  pyro4: "#c81000",
  pyro5: "#ff4422",
  pyro6: "#e83820",
  nyx1: "#1880d0",
  nyx2: "#22ccc0",
  nyx3: "#5570ff",
};
const MOON_COLOR = "#9ab4cc";

function bodyColor(body: StarmapBodyItem): string {
  if (body.navIcon === "Moon") return MOON_COLOR;
  const stem = body.recordName.split(".").pop()?.toLowerCase() ?? "";
  return BODY_COLORS[stem] ?? SYSTEM_COLORS[body.systemName] ?? "#f5a623";
}

// ── Sphère (LOT 3) : constantes + helpers (port V1) ──
const SPHERE_LABEL_CAP = 40;
const SPHERE_ORB_R = 1.7;
const SPHERE_TRANS_HW = 1.2;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const STANTON_STEMS = [
  "stanton1", "stanton1a", "stanton1b", "stanton1c", "stanton1d",
  "stanton2", "stanton2a", "stanton2b", "stanton2c",
  "stanton3", "stanton3a", "stanton3b",
  "stanton4", "stanton4a", "stanton4b", "stanton4c",
];
const PYRO_TINT = "#ff3b2e";
const NYX_TINT = "#3b6bff";
const TINT_ALPHA = 0.55;
const TINT_COMPOSITE: GlobalCompositeOperation = "multiply";

function stableHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

// Fibonacci sphere — répartit N points sur une sphère unité.
function fibSphere(i: number, N: number): [number, number, number] {
  const y = 1 - (2 * i + 1) / N;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const t = GOLDEN_ANGLE * i;
  return [r * Math.cos(t), y, r * Math.sin(t)];
}

// Rotation deux axes : pitch (X) puis yaw (Y).
function rotateYX(
  [px, py, pz]: [number, number, number],
  yaw: number,
  pitch: number,
): [number, number, number] {
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const ry = py * cp - pz * sp;
  const rz0 = py * sp + pz * cp;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const rx = px * cy + rz0 * sy;
  const rz1 = -px * sy + rz0 * cy;
  return [rx, ry, rz1];
}

function lightenBody(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lc = (c: number) => Math.min(255, Math.round(c + (255 - c) * 0.6)).toString(16).padStart(2, "0");
  return `#${lc(r)}${lc(g)}${lc(b)}`;
}

function darkenBody(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const dc = (c: number) => Math.max(0, Math.round(c * 0.5)).toString(16).padStart(2, "0");
  return `#${dc(r)}${dc(g)}${dc(b)}`;
}

// Taille : r = compression log10 → [3,18] px.
const LOG_MIN = Math.log10(75_000);
const LOG_MAX = Math.log10(696_000_000);
function compressSize(size: number | null): number {
  if (!size || size <= 0) return 3;
  const lv = Math.log10(size);
  return Math.max(3, Math.min(18, 3 + (15 * (lv - LOG_MIN)) / (LOG_MAX - LOG_MIN)));
}

function safeName(body: StarmapBodyItem): string {
  const n = body.name;
  if (!n || n.startsWith("@") || n.toLowerCase().includes("uninitialized") || n.toLowerCase().includes("loc_")) {
    return body.recordName.split(".").pop() ?? body.navIcon;
  }
  return n;
}

// Angles « répartis » déterministes.
const BASE_ANGLES_4 = [18, 232, 108, 300];
const BASE_ANGLES_6 = [30, 90, 150, 210, 270, 330];
function spreadAngles(count: number): number[] {
  if (count <= 4) {
    const base = BASE_ANGLES_4.slice(0, count);
    return base.length < count ? Array.from({ length: count }, (_, i) => (i * 360) / count) : base;
  }
  if (count <= 6) {
    const base = BASE_ANGLES_6.slice(0, count);
    return base.length < count ? Array.from({ length: count }, (_, i) => (i * 360) / count) : base;
  }
  return Array.from({ length: count }, (_, i) => (i * 360) / count);
}

// Placement schématique (pas de coords réelles : posX toujours NULL → ce chemin).
function schematicPos(ring: number, angDeg: number): { wx: number; wy: number; ring: number; ang: number } {
  const ang = angDeg * (Math.PI / 180);
  return { wx: ring * Math.cos(ang), wy: ring * Math.sin(ang) * TILT, ring, ang };
}

function angDiff(a: number, b: number): number {
  let d = (a - b) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

function buildPoiLayouts(pois: StarmapBodyItem[], cx: number, cy: number, parentRv: number): BodyLayout[] {
  return pois.map((poi, j) => {
    const ring = parentRv + 30 + j * 14;
    const ang = ((j / Math.max(pois.length, 1)) * 360 + 45) * (Math.PI / 180);
    const wx = cx + ring * Math.cos(ang);
    const wy = cy + ring * Math.sin(ang) * TILT;
    return { body: poi, wx, wy, rv: 3, ring, ang, children: [] };
  });
}

function buildSystemLayout(bodies: StarmapBodyItem[], systemId: string): SystemLayout {
  const gpos = GALAXY_POSITIONS[systemId] ?? { gx: 0, gy: 0 };

  const star = bodies.find((b) => b.navIcon === "Star") ?? null;
  const planets = bodies
    .filter((b) => b.navIcon === "Planet")
    .sort((a, b) => (a.orbitOrder ?? 99) - (b.orbitOrder ?? 99));
  const moons = bodies.filter((b) => b.navIcon === "Moon");
  const lagrange = bodies.filter((b) => b.navIcon === "Lagrange");
  const pois = bodies.filter((b) => ["LandingZone", "Station", "Outpost"].includes(b.navIcon));

  const angles = spreadAngles(planets.length);
  const planetLayouts: BodyLayout[] = planets.map((p, i) => {
    const { wx, wy, ring, ang } = schematicPos(FIRST_RING + i * RING_STEP, angles[i] ?? i * 60);
    const rv = compressSize(p.size);

    const myMoons = moons.filter(
      (m) => m.parentRef?.toLowerCase() === p.recordName.split(".").pop()?.toLowerCase(),
    );
    const placedAngles: number[] = [];
    const moonLayouts: BodyLayout[] = myMoons.map((m, j) => {
      const moonRing = rv + 22 + j * 18;
      let moonAngle = ((j / Math.max(myMoons.length, 1)) * 360 - 60) * (Math.PI / 180);
      let guard = 0;
      while (guard++ < 32 && placedAngles.some((a) => Math.abs(angDiff(a, moonAngle)) < MOON_ANGLE_SEP)) {
        moonAngle += MOON_ANGLE_SEP;
      }
      placedAngles.push(moonAngle);
      const mx = wx + moonRing * Math.cos(moonAngle);
      const my = wy + moonRing * Math.sin(moonAngle) * TILT;
      const moonStem = m.recordName.split(".").pop();
      const moonPois = pois.filter((poi) => poi.parentRef?.toLowerCase() === moonStem?.toLowerCase());
      const poiLayouts = buildPoiLayouts(moonPois, mx, my, compressSize(m.size));
      return { body: m, wx: mx, wy: my, rv: compressSize(m.size), ring: moonRing, ang: moonAngle, children: poiLayouts };
    });

    const planetStem = p.recordName.split(".").pop();
    const planetPois = pois.filter((poi) => poi.parentRef?.toLowerCase() === planetStem?.toLowerCase());
    const poiLayouts = buildPoiLayouts(planetPois, wx, wy, rv);

    const planetStemLc = planetStem?.toLowerCase();
    const myLagrange = lagrange.filter(
      (lp) => lp.recordName.split(".").pop()?.replace(/_L[1-5]$/i, "").toLowerCase() === planetStemLc,
    );
    const lagrangeChildLayouts: BodyLayout[] = myLagrange.map((lp, k) => {
      const lAng = (k / Math.max(myLagrange.length, 1)) * 2 * Math.PI;
      return {
        body: lp,
        wx: wx + LAGRANGE_RING * Math.cos(lAng),
        wy: wy + LAGRANGE_RING * Math.sin(lAng) * TILT,
        rv: 2.5,
        ring: LAGRANGE_RING,
        ang: lAng,
        children: [],
      };
    });

    return { body: p, wx, wy, rv, ring, ang, children: [...moonLayouts, ...lagrangeChildLayouts, ...poiLayouts] };
  });

  // Lunes orphelines (ex Delamar → NyxStar) sur anneaux externes.
  const orphanMoons = moons.filter((m) => {
    const parentStem = m.parentRef ?? "";
    return !planets.some((p) => p.recordName.split(".").pop()?.toLowerCase() === parentStem.toLowerCase());
  });
  const orphanAngles = spreadAngles(orphanMoons.length);
  const orphanLayouts: BodyLayout[] = orphanMoons.map((m, i) => {
    const ring = (planets.length + i + 1) * RING_STEP + FIRST_RING;
    const ang = (orphanAngles[i] ?? i * 90) * (Math.PI / 180);
    const wx = ring * Math.cos(ang);
    const wy = ring * Math.sin(ang) * TILT;
    return { body: m, wx, wy, rv: compressSize(m.size), ring, ang, children: [] };
  });

  return {
    id: systemId,
    name: SYSTEM_NAMES[systemId] ?? systemId.toUpperCase(),
    color: SYSTEM_COLORS[systemId] ?? "#f5a623",
    star: star ? { body: star, wx: 0, wy: 0, rv: compressSize(star.size), ring: 0, ang: 0, children: [] } : null,
    planets: planetLayouts,
    moons: orphanLayouts,
    pois: [],
    gx: gpos.gx,
    gy: gpos.gy,
  };
}

function cssVar(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

// ── Composant ──
export default function StarmapCanvas({
  bodies,
  initialSystem = "stanton",
  height = 560,
}: {
  bodies: StarmapBodyItem[];
  initialSystem?: string;
  height?: number | string;
}) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const camRef = useRef<Cam>({ x: 0, y: 0, z: 1 });
  const animRef = useRef<number | null>(null);
  const bgStarsRef = useRef<Array<{ x: number; y: number; r: number; o: number }>>([]);
  const hitTargetsRef = useRef<HitTarget[]>([]);
  const layoutsRef = useRef<Record<string, SystemLayout>>({});
  const yawRef = useRef(0); // sphère — yaw (Y, drag horizontal)
  const pitchRef = useRef(0); // sphère — pitch (X, drag vertical)
  // Images sphère par stem : <img> décodée | 'loading' | 'none'.
  const bodyImgRef = useRef<Map<string, HTMLImageElement | "loading" | "none">>(new Map());

  const [activeSystem, setActiveSystem] = useState(initialSystem);
  const [zoomLabel, setZoomLabel] = useState(() => t("starmap.level.system"));
  const [systemLabel, setSystemLabel] = useState(SYSTEM_NAMES[initialSystem] ?? "STANTON");
  const [noData, setNoData] = useState(false);

  useEffect(() => {
    const grouped: Record<string, StarmapBodyItem[]> = {};
    for (const b of bodies) (grouped[b.systemName] ??= []).push(b);
    const layouts: Record<string, SystemLayout> = {};
    for (const [sys, list] of Object.entries(grouped)) layouts[sys] = buildSystemLayout(list, sys);
    layoutsRef.current = layouts;
    setNoData(Object.keys(layouts).length === 0);
  }, [bodies]);

  useEffect(() => {
    bgStarsRef.current = Array.from({ length: 160 }, () => ({
      x: Math.random() * 2 - 1,
      y: Math.random() * 2 - 1,
      r: Math.random() * 1.1 + 0.2,
      o: Math.random() * 0.45 + 0.08,
    }));
  }, []);

  // Réinitialise la rotation sphère au changement de système.
  useEffect(() => {
    yawRef.current = 0;
    pitchRef.current = 0;
  }, [activeSystem]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctxRaw = canvas.getContext("2d");
    if (!ctxRaw) return;
    const ctx = ctxRaw; // narrow CanvasRenderingContext2D pour les closures

    const W = container.clientWidth;
    const H = container.clientHeight;
    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== W * DPR || canvas.height !== H * DPR) {
      canvas.width = W * DPR;
      canvas.height = H * DPR;
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    }

    const cam = camRef.current;
    const amber = cssVar("--amber", "#f59e0b");
    const copper = cssVar("--copper", "#c2773f");
    const good = cssVar("--good", "#34d399");
    const txt2 = cssVar("--txt-2", "#8899aa");
    const line = cssVar("--line", "#1e2a38");

    function lvl(): ZoomLevel {
      if (cam.z < GLX_THRESHOLD) return "galaxy";
      if (cam.z > SPHERE_THRESHOLD) return "sphere"; // LOT 3
      if (cam.z > PLN_THRESHOLD) return "planet"; // LOT 3
      return "system";
    }

    function w2s(wx: number, wy: number) {
      return { x: W / 2 + (wx - cam.x) * cam.z, y: H / 2 + (wy - cam.y) * cam.z };
    }

    function drawBgStars() {
      for (const s of bgStarsRef.current) {
        const px = W / 2 + s.x * W * 0.7 - cam.x * 0.06 * cam.z;
        const py = H / 2 + s.y * H * 0.7 - cam.y * 0.06 * cam.z;
        const x = ((px % W) + W) % W;
        const y = ((py % H) + H) % H;
        ctx.globalAlpha = s.o;
        ctx.fillStyle = "#d4e8f0";
        ctx.beginPath();
        ctx.arc(x, y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    function drawOrbitRing(cxw: number, cyw: number, ring: number, stroke: string, lw: number, op: number, dash?: number[]) {
      const c = w2s(cxw, cyw);
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lw;
      ctx.globalAlpha = op;
      if (dash) ctx.setLineDash(dash);
      else ctx.setLineDash([]);
      ctx.beginPath();
      ctx.ellipse(0, 0, ring * cam.z, ring * cam.z * TILT, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
    }

    function glowDot(x: number, y: number, r: number, col: string, glowR: number) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, glowR);
      g.addColorStop(0, col);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, glowR, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    function label(x: number, y: number, name: string, type: string | null, col: string) {
      ctx.font = "500 11px var(--font-display, monospace)";
      ctx.fillStyle = col;
      ctx.textAlign = "left";
      ctx.fillText(name.toUpperCase(), x, y);
      if (type) {
        ctx.font = "9px var(--font-mono, monospace)";
        ctx.fillStyle = txt2;
        ctx.fillText(type.toUpperCase(), x, y + 12);
      }
    }

    ctx.clearRect(0, 0, W, H);
    drawBgStars();
    hitTargetsRef.current = [];
    const lv = lvl();

    // Fondu au noir lors de l'entrée/sortie de la sphère (seulement >= seuil sphère).
    const transT =
      cam.z < SPHERE_THRESHOLD ? 0 : Math.max(0, 1 - Math.abs(cam.z - SPHERE_THRESHOLD) / SPHERE_TRANS_HW);
    const drawOverlay = () => {
      if (transT < 0.01) return;
      ctx.fillStyle = "#0a0b0f";
      ctx.globalAlpha = transT * 0.92;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    };

    // ── GALAXIE ──
    if (lv === "galaxy") {
      setSystemLabel(t("starmap.level.galaxy"));
      setZoomLabel(t("starmap.level.galaxy"));
      ctx.strokeStyle = `${amber}55`;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 6]);
      for (const [a, b] of GALAXY_LINKS) {
        const A = layoutsRef.current[a];
        const B = layoutsRef.current[b];
        if (!A || !B) continue;
        const pa = w2s(A.gx, A.gy);
        const pb = w2s(B.gx, B.gy);
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      for (const [sysId, layout] of Object.entries(layoutsRef.current)) {
        const p = w2s(layout.gx, layout.gy);
        glowDot(p.x, p.y, 5, layout.color, 22);
        label(p.x + 12, p.y + 4, layout.name, t("starmap.level.system"), layout.color);
        hitTargetsRef.current.push({ x: p.x, y: p.y, r: 22, wx: layout.gx, wy: layout.gy, z: 1.0, systemId: sysId });
      }
      return;
    }

    const sysLayout = layoutsRef.current[activeSystem];
    if (!sysLayout) return;

    // ── SPHÈRE (globe fake-3D, rotation deux axes) ──
    if (lv === "sphere") {
      const allBodies = [
        ...sysLayout.planets,
        ...sysLayout.moons,
        ...sysLayout.planets.flatMap((p) => p.children.filter((c) => c.body.navIcon === "Moon")),
      ];
      let best: BodyLayout | null = null;
      let bd = 1e9;
      for (const bl of allBodies) {
        const d = Math.hypot(bl.wx - cam.x, bl.wy - cam.y);
        if (d < bd) {
          bd = d;
          best = bl;
        }
      }
      if (!best || bd >= 80) {
        setZoomLabel(t("starmap.level.sphere"));
        return;
      }

      setSystemLabel(safeName(best.body).toUpperCase());
      setZoomLabel(t("starmap.level.sphere"));

      const cx = W / 2;
      const cy = H / 2;
      const R = Math.min(W, H) * 0.32;

      const sphCol = bodyColor(best.body);
      const sphHigh = lightenBody(sphCol);
      const sphDark = darkenBody(sphCol);

      // Résout une image de corps via cache : 1 appel + décodage par stem, réutilisé.
      const resolveImage = (s: string): HTMLImageElement | null => {
        const c = bodyImgRef.current.get(s);
        if (c === undefined && s) {
          bodyImgRef.current.set(s, "loading");
          void invoke<string | null>("get_starmap_body_image", { stem: s })
            .then((data) => {
              if (data) {
                const img = new Image();
                img.onload = () => {
                  bodyImgRef.current.set(s, img);
                  draw();
                };
                img.onerror = () => {
                  bodyImgRef.current.set(s, "none");
                  draw();
                };
                img.src = data;
              } else {
                bodyImgRef.current.set(s, "none");
                draw();
              }
            })
            .catch(() => {
              bodyImgRef.current.set(s, "none");
              draw();
            });
        }
        return c instanceof HTMLImageElement && c.complete ? c : null;
      };

      const stem = best.body.recordName.split(".").pop()?.toLowerCase() ?? "";
      const ownImg = resolveImage(stem);
      const ownNone = bodyImgRef.current.get(stem) === "none";

      // Pyro/Nyx (pas d'image propre) empruntent une image Stanton, teintée.
      const sys = best.body.systemName;
      const tint = sys === "pyro" ? PYRO_TINT : sys === "nyx" ? NYX_TINT : null;
      const borrowStem =
        ownNone && tint ? STANTON_STEMS[stableHash(best.body.recordName) % STANTON_STEMS.length] ?? null : null;
      const borrowedImg = borrowStem ? resolveImage(borrowStem) : null;

      if (ownImg) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(ownImg, cx - R, cy - R, 2 * R, 2 * R);
        ctx.restore();
      } else if (borrowedImg && tint) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(borrowedImg, cx - R, cy - R, 2 * R, 2 * R);
        ctx.globalCompositeOperation = TINT_COMPOSITE;
        ctx.globalAlpha = TINT_ALPHA;
        ctx.fillStyle = tint;
        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 1;
        ctx.restore();
      } else {
        const lx = cx - R * 0.35;
        const ly = cy - R * 0.35;
        const sphGrad = ctx.createRadialGradient(lx, ly, R * 0.04, cx, cy, R);
        sphGrad.addColorStop(0, sphHigh);
        sphGrad.addColorStop(0.4, sphCol);
        sphGrad.addColorStop(0.82, sphDark);
        sphGrad.addColorStop(1, "#050608");
        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, Math.PI * 2);
        ctx.fillStyle = sphGrad;
        ctx.fill();
      }

      // Rim atmosphérique.
      const atmGrad = ctx.createRadialGradient(cx, cy, R * 0.86, cx, cy, R * 1.2);
      atmGrad.addColorStop(0, `${sphCol}00`);
      atmGrad.addColorStop(0.5, `${sphCol}44`);
      atmGrad.addColorStop(1, `${sphCol}00`);
      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.2, 0, Math.PI * 2);
      ctx.fillStyle = atmGrad;
      ctx.fill();

      ctx.textAlign = "center";
      ctx.font = "600 13px var(--font-display, monospace)";
      ctx.fillStyle = sphHigh;
      ctx.fillText(safeName(best.body).toUpperCase(), W / 2, cy + R + 28);
      ctx.font = "9px var(--font-mono, monospace)";
      ctx.fillStyle = txt2;
      ctx.fillText(best.body.navIcon.toUpperCase(), W / 2, cy + R + 41);
      ctx.textAlign = "left";

      // POI : sol (!showOrbitLine) sur surface, orbital (showOrbitLine) sur anneau.
      const groundPois = best.children.filter((c) => c.body.navIcon !== "Moon" && !c.body.showOrbitLine);
      const orbPois = best.children.filter((c) => c.body.navIcon !== "Moon" && c.body.showOrbitLine);
      const totalPois = groundPois.length + orbPois.length;

      const yaw = yawRef.current;
      const pitch = pitchRef.current;

      type ProjPOI = { bl: BodyLayout; rx: number; ry: number; rz: number; orbital: boolean };
      const projected: ProjPOI[] = [];

      groundPois.forEach((bl, i) => {
        const [x, y, z] = fibSphere(i, Math.max(groundPois.length, 1));
        const [rx, ry, rz] = rotateYX([x, y, z], yaw, pitch);
        projected.push({ bl, rx, ry, rz, orbital: false });
      });
      orbPois.forEach((bl, i) => {
        const ang = (i / Math.max(orbPois.length, 1)) * Math.PI * 2;
        const [rx, ry, rz] = rotateYX([Math.cos(ang), 0, Math.sin(ang)], yaw, pitch);
        projected.push({ bl, rx, ry, rz, orbital: true });
      });

      projected.sort((a, b) => a.rz - b.rz);

      const labelSet = new Set<BodyLayout>(
        [...projected]
          .filter((p) => (p.orbital ? p.rz > -0.15 : p.rz > 0))
          .sort((a, b) => b.rz - a.rz)
          .slice(0, SPHERE_LABEL_CAP)
          .map((p) => p.bl),
      );

      for (const { bl, rx, ry, rz, orbital } of projected) {
        if (orbital ? rz <= -0.15 : rz <= 0) continue; // cull face arrière
        const depth = (rz + 1) / 2;
        ctx.globalAlpha = 0.3 + 0.7 * depth;
        const poiCol = bl.body.showOrbitLine
          ? amber
          : bl.body.navIcon === "LandingZone"
            ? good
            : copper;
        if (orbital) {
          const orbR = R * SPHERE_ORB_R;
          const sx = cx + orbR * rx;
          const sy = cy - orbR * ry;
          const sfx = cx + R * rx;
          const sfy = cy - R * ry;
          ctx.strokeStyle = `${poiCol}55`;
          ctx.lineWidth = 0.7;
          ctx.setLineDash([2, 4]);
          ctx.beginPath();
          ctx.moveTo(sfx, sfy);
          ctx.lineTo(sx, sy);
          ctx.stroke();
          ctx.setLineDash([]);
          glowDot(sx, sy, 4, poiCol, 12);
          if (labelSet.has(bl)) label(sx + 7, sy + 3, safeName(bl.body), t("starmap.label.station"), poiCol);
          hitTargetsRef.current.push({ x: sx, y: sy, r: 14, wx: best.wx, wy: best.wy, z: cam.z });
        } else {
          const sx = cx + R * rx;
          const sy = cy - R * ry;
          glowDot(sx, sy, 3.5, poiCol, 9);
          if (labelSet.has(bl)) label(sx + 7, sy + 3, safeName(bl.body), bl.body.navIcon, poiCol);
          hitTargetsRef.current.push({ x: sx, y: sy, r: 14, wx: best.wx, wy: best.wy, z: cam.z });
        }
        ctx.globalAlpha = 1;
      }

      if (totalPois === 0) {
        ctx.font = "10px var(--font-mono, monospace)";
        ctx.fillStyle = txt2;
        ctx.textAlign = "center";
        ctx.globalAlpha = 0.55;
        ctx.fillText(t("starmap.noPoiReferenced"), W / 2, cy + R + 56);
        ctx.globalAlpha = 1;
        ctx.textAlign = "left";
      }

      const hintParts: string[] = [];
      if (groundPois.length > 0) hintParts.push(t("starmap.hintGround", { n: groundPois.length }));
      if (orbPois.length > 0) hintParts.push(t("starmap.hintOrbital", { n: orbPois.length }));
      const hintPoi = hintParts.length > 0 ? hintParts.join(" · ") : t("starmap.hintNoPoi");
      ctx.font = "9px var(--font-mono, monospace)";
      ctx.fillStyle = txt2;
      ctx.textAlign = "center";
      ctx.globalAlpha = 0.55;
      ctx.fillText(t("starmap.sphereHint", { poi: hintPoi }), W / 2, H - 16);
      ctx.textAlign = "left";
      ctx.globalAlpha = 1;

      drawOverlay();

      // Clic sphère → retour niveau planète.
      hitTargetsRef.current.push({ x: cx, y: cy, r: R, wx: best.wx, wy: best.wy, z: PLN_THRESHOLD + 0.5 });
      return;
    }

    // ── PLANÈTE / LUNE (zoom corps + lunes + Lagrange) ──
    if (lv === "planet") {
      const allBodies = [
        ...sysLayout.planets,
        ...sysLayout.moons,
        ...sysLayout.planets.flatMap((p) => p.children.filter((c) => c.body.navIcon === "Moon")),
      ];
      let best: BodyLayout | null = null;
      let bd = 1e9;
      for (const bl of allBodies) {
        const d = Math.hypot(bl.wx - cam.x, bl.wy - cam.y);
        if (d < bd) {
          bd = d;
          best = bl;
        }
      }
      if (best && bd < 80) {
        setSystemLabel(safeName(best.body).toUpperCase());
        setZoomLabel(best.body.navIcon === "Moon" ? t("starmap.level.moon") : t("starmap.level.planet"));
        const c = w2s(best.wx, best.wy);
        const pr = Math.min(50, best.rv * 2.8) * Math.min(cam.z / 4, 1.6);
        const bestCol = bodyColor(best.body);
        glowDot(c.x, c.y, pr, bestCol, pr + 30);
        label(c.x + pr + 8, c.y + 4, safeName(best.body), best.body.navIcon, bestCol);
        // Lunes de la planète (anneaux cliquables → sphère).
        for (const child of best.children.filter((c) => c.body.navIcon === "Moon")) {
          drawOrbitRing(best.wx, best.wy, child.ring, `${bestCol}66`, 1, 0.45);
          const cs = w2s(child.wx, child.wy);
          glowDot(cs.x, cs.y, child.rv + 1.5, MOON_COLOR, (child.rv + 1.5) * 2.8);
          label(cs.x + child.rv + 6, cs.y + 3, safeName(child.body), child.body.navIcon, MOON_COLOR);
          hitTargetsRef.current.push({ x: cs.x, y: cs.y, r: 14, wx: child.wx, wy: child.wy, z: cam.z });
        }
        // Points de Lagrange — marqueurs ambre sur anneau pointillé (non zoomables).
        const lagPts = best.children.filter((c) => c.body.navIcon === "Lagrange");
        if (lagPts.length > 0) drawOrbitRing(best.wx, best.wy, LAGRANGE_RING, `${amber}66`, 1, 0.3, [3, 5]);
        for (const lp of lagPts) {
          const ls = w2s(lp.wx, lp.wy);
          glowDot(ls.x, ls.y, 2.5, amber, 7);
          const lnum = lp.body.recordName.match(/_L([1-5])$/i)?.[1];
          label(ls.x + 6, ls.y + 3, lnum ? `L${lnum}` : safeName(lp.body), null, amber);
        }
        // Clic sur le corps → sphère.
        hitTargetsRef.current.push({ x: c.x, y: c.y, r: pr * 0.7, wx: best.wx, wy: best.wy, z: SPHERE_THRESHOLD + 1 });
        drawOverlay();
        return;
      }
    }

    // ── SYSTÈME ──
    setSystemLabel(sysLayout.name);
    setZoomLabel(t("starmap.level.system"));

    if (sysLayout.star) {
      const sc = w2s(0, 0);
      const sr = Math.max(8, sysLayout.star.rv * Math.min(cam.z, 1.5));
      const starCol = bodyColor(sysLayout.star.body);
      glowDot(sc.x, sc.y, sr, starCol, sr * 4);
      label(sc.x - 70, sc.y + sr + 12, sysLayout.name, t("starmap.label.star"), starCol);
      hitTargetsRef.current.push({ x: sc.x, y: sc.y, r: 24, wx: 0, wy: 0, z: 2.0 });
    }

    if (sysLayout.planets.length >= 3) {
      const r2 = sysLayout.planets[1]?.ring ?? 0;
      const r3 = sysLayout.planets[2]?.ring ?? 0;
      drawOrbitRing(0, 0, (r2 + r3) / 2, `${line}`, 4, 0.18, [1, 5]);
    }

    for (const pl of sysLayout.planets) drawOrbitRing(0, 0, pl.ring, `${sysLayout.color}44`, 1, 0.38);
    for (const ml of sysLayout.moons) drawOrbitRing(0, 0, ml.ring, `${sysLayout.color}33`, 1, 0.28);

    const placedLabels: { x: number; y: number }[] = [];
    for (const pl of sysLayout.planets) {
      const s = w2s(pl.wx, pl.wy);
      const r = pl.rv * Math.min(cam.z, 1.4);
      const pc = bodyColor(pl.body);
      ctx.strokeStyle = pc;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.45;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r + 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      glowDot(s.x, s.y, r, pc, r * 3.2);
      const lx = s.x + r + 8;
      let ly = s.y + 2;
      let guard = 0;
      while (
        guard++ < 8 &&
        placedLabels.some((p) => Math.abs(p.x - lx) < LABEL_NUDGE_DIST && Math.abs(p.y - ly) < LABEL_NUDGE_DIST)
      ) {
        ly += LABEL_NUDGE_DIST;
      }
      placedLabels.push({ x: lx, y: ly });
      label(lx, ly, safeName(pl.body), pl.body.navIcon, "#d4e8f0");
      hitTargetsRef.current.push({ x: s.x, y: s.y, r: Math.max(18, r + 8), wx: pl.wx, wy: pl.wy, z: 5.0 });
      if (lv !== "system") {
        for (const ml of pl.children.filter((c) => c.body.navIcon === "Moon")) {
          const ms = w2s(ml.wx, ml.wy);
          glowDot(ms.x, ms.y, 2.5, `${MOON_COLOR}bb`, 7);
          hitTargetsRef.current.push({ x: ms.x, y: ms.y, r: 10, wx: ml.wx, wy: ml.wy, z: 5.5 });
        }
      }
    }

    for (const ml of sysLayout.moons) {
      const s = w2s(ml.wx, ml.wy);
      glowDot(s.x, s.y, ml.rv * Math.min(cam.z, 1.2), MOON_COLOR, ml.rv * 2.5);
      label(s.x + ml.rv + 7, s.y + 2, safeName(ml.body), t("starmap.level.moon"), MOON_COLOR);
      hitTargetsRef.current.push({ x: s.x, y: s.y, r: Math.max(12, ml.rv + 6), wx: ml.wx, wy: ml.wy, z: 5.0 });
    }
  }, [activeSystem, t]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(container);
    draw();
    return () => ro.disconnect();
  }, [draw]);

  const flyTo = useCallback(
    (wx: number, wy: number, z: number, sysId?: string) => {
      if (sysId) setActiveSystem(sysId);
      const t0 = performance.now();
      const dur = 620;
      const cam = camRef.current;
      const sx = cam.x;
      const sy = cam.y;
      const sz = cam.z;
      function ease(t: number) {
        return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      }
      function step(now: number) {
        const k = Math.min(1, (now - t0) / dur);
        const e = ease(k);
        cam.x = sx + (wx - sx) * e;
        cam.y = sy + (wy - sy) * e;
        cam.z = sz + (z - sz) * e;
        draw();
        if (k < 1) animRef.current = requestAnimationFrame(step);
        else animRef.current = null;
      }
      if (animRef.current) cancelAnimationFrame(animRef.current);
      animRef.current = requestAnimationFrame(step);
    },
    [draw],
  );

  const zoomAt = useCallback(
    (sx: number, sy: number, factor: number) => {
      const container = containerRef.current;
      if (!container) return;
      const W = container.clientWidth;
      const H = container.clientHeight;
      const cam = camRef.current;
      const wx = cam.x + (sx - W / 2) / cam.z;
      const wy = cam.y + (sy - H / 2) / cam.z;
      cam.z = Math.max(MINZ, Math.min(MAXZ, cam.z * factor));
      cam.x = wx - (sx - W / 2) / cam.z;
      cam.y = wy - (sy - H / 2) / cam.z;
      draw();
    },
    [draw],
  );

  const dragRef = useRef(false);
  const movedRef = useRef(false);
  const lastRef = useRef({ x: 0, y: 0 });
  const downRef = useRef({ x: 0, y: 0 });

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    dragRef.current = true;
    movedRef.current = false;
    lastRef.current = { x: e.clientX, y: e.clientY };
    downRef.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!dragRef.current) return;
      if (Math.abs(e.clientX - downRef.current.x) + Math.abs(e.clientY - downRef.current.y) > 4) movedRef.current = true;
      const cam = camRef.current;
      if (cam.z > SPHERE_THRESHOLD) {
        // Niveau sphère : drag horizontal = yaw, vertical = pitch.
        yawRef.current += (e.clientX - lastRef.current.x) * 0.007;
        pitchRef.current += (e.clientY - lastRef.current.y) * 0.007;
      } else {
        cam.x -= (e.clientX - lastRef.current.x) / cam.z;
        cam.y -= (e.clientY - lastRef.current.y) / cam.z;
      }
      lastRef.current = { x: e.clientX, y: e.clientY };
      draw();
    },
    [draw],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      dragRef.current = false;
      if (movedRef.current) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      let hit: HitTarget | null = null;
      let bd = 1e9;
      for (const tgt of hitTargetsRef.current) {
        const d = Math.hypot(tgt.x - sx, tgt.y - sy);
        if (d < tgt.r && d < bd) {
          bd = d;
          hit = tgt;
        }
      }
      if (hit) flyTo(hit.wx, hit.wy, hit.z, hit.systemId);
    },
    [flyTo],
  );

  const onWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const factor = Math.max(WHEEL_FACTOR_MIN, Math.min(WHEEL_FACTOR_MAX, Math.exp(-e.deltaY * WHEEL_SENS)));
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, factor);
    },
    [zoomAt],
  );

  useEffect(() => () => {
    if (animRef.current) cancelAnimationFrame(animRef.current);
  }, []);

  if (noData) {
    return (
      <div
        className="flex items-center justify-center rounded-2xl border border-white/10 text-sm text-white/40"
        style={{ height, background: "rgba(8,10,16,0.5)" }}
      >
        {t("starmap.noDataCanvas")}
      </div>
    );
  }

  const navBtn =
    "cursor-pointer rounded px-2 py-0.5 text-[11px] font-semibold tracking-wider text-white/60 transition-colors hover:text-accent";
  const zBtn =
    "flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-black/40 text-white/70 transition-colors hover:border-accent/50 hover:text-accent";

  return (
    <div
      ref={containerRef}
      className="relative overflow-hidden rounded-2xl border border-white/10"
      style={{ height, background: "radial-gradient(ellipse at center, #0b0e16 0%, #05060a 100%)" }}
    >
      {/* HUD haut */}
      <div className="absolute left-3 top-3 z-10 flex items-center gap-1.5">
        <span className={navBtn} onClick={() => flyTo(0, 0, 0.25)}>
          GLX
        </span>
        <span className={navBtn} onClick={() => flyTo(0, 0, 1)}>
          SYS
        </span>
        <span
          className={navBtn}
          onClick={() => flyTo(camRef.current.x, camRef.current.y, PLN_THRESHOLD + 1)}
        >
          OBJ
        </span>
        <span className="ml-2 text-[12px] font-bold uppercase tracking-[0.18em]" style={{ color: "var(--accent)" }}>
          {systemLabel}
        </span>
      </div>

      {/* Boutons zoom */}
      <div className="absolute right-3 top-3 z-10 flex flex-col gap-1.5">
        <button
          type="button"
          className={zBtn}
          onClick={() => zoomAt(containerRef.current!.clientWidth / 2, containerRef.current!.clientHeight / 2, 1.3)}
        >
          +
        </button>
        <button
          type="button"
          className={zBtn}
          onClick={() => zoomAt(containerRef.current!.clientWidth / 2, containerRef.current!.clientHeight / 2, 0.77)}
        >
          −
        </button>
        <button type="button" className={zBtn} onClick={() => flyTo(0, 0, 1)}>
          ⊙
        </button>
      </div>

      {/* HUD bas */}
      <span className="absolute bottom-3 left-3 z-10 text-[10px] uppercase tracking-wider text-white/30">
        {t("starmap.hudHint")}
      </span>
      <span className="absolute bottom-3 right-3 z-10 text-[10px] uppercase tracking-[0.14em]" style={{ color: "#c2773f" }}>
        {zoomLabel}
      </span>

      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
        style={{ cursor: "grab", display: "block", touchAction: "none" }}
      />
    </div>
  );
}
