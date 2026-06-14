// Fond étoilé animé global (port V1 StarsBackground). Canvas plein écran, points
// blancs faible opacité dérivant lentement. Monté = animé, démonté = arrêté
// (le rendu conditionnel est géré par Layout selon animatedStarsBg).
// z-index 1 : au-dessus du glow du fond (z-0), sous le contenu (z-10) → le glow
// teinté reste visible, les étoiles scintillent par-dessus, l'UI passe devant.

import { useEffect, useRef } from "react";

// Nombre d'étoiles (canvas une seule couche → coût ~linéaire, fluide même élevé).
// Densité augmentée (~2,5× l'origine de 140) pour un ciel plus fourni sans saturer.
const STAR_COUNT = 760;

interface Star {
  x: number;
  y: number;
  radius: number;
  opacity: number;
  speed: number;
}

function initStars(count: number, w: number, h: number): Star[] {
  return Array.from({ length: count }, () => ({
    x: Math.random() * w,
    y: Math.random() * h,
    radius: Math.random() * 1.2 + 0.2,
    opacity: Math.random() * 0.2 + 0.05,
    speed: Math.random() * 0.08 + 0.02,
  }));
}

export function StarsBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<number>(0);
  const starsRef = useRef<Star[]>([]);
  const activeRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      starsRef.current = initStars(STAR_COUNT, canvas.width, canvas.height);
    };
    resize();
    window.addEventListener("resize", resize);
    activeRef.current = true;

    const tick = () => {
      if (!activeRef.current) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const s of starsRef.current) {
        s.x += s.speed;
        if (s.x > canvas.width + 2) s.x = -2;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${s.opacity})`;
        ctx.fill();
      }
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);

    return () => {
      activeRef.current = false;
      cancelAnimationFrame(frameRef.current);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0"
      style={{ zIndex: 1 }}
      aria-hidden="true"
    />
  );
}

export default StarsBackground;
