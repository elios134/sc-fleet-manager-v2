// Fond « Ciel étoilé » (ancien fond de l'app, port V1) : canvas plein écran de points blancs de
// faible opacité qui dérivent lentement, par-dessus le fond teinté de Layout. En pause (jeu lancé,
// fenêtre cachée, réglage coupé), les étoiles restent affichées, immobiles.
import { useEffect, useRef } from "react";
import { useAnimationGate } from "./useAnimationGate";

const STAR_COUNT = 1500;
const PAUSED_CHECK_MS = 1_000;

type Star = { x: number; y: number; radius: number; opacity: number; speed: number };

function initStars(w: number, h: number): Star[] {
  return Array.from({ length: STAR_COUNT }, () => ({
    x: Math.random() * w,
    y: Math.random() * h,
    radius: Math.random() * 1.2 + 0.2,
    opacity: Math.random() * 0.2 + 0.05,
    speed: Math.random() * 0.08 + 0.02,
  }));
}

export function StarsBackground({ enabled }: { enabled: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const running = useAnimationGate(enabled);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    let stars: Star[] = [];
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const s of stars) {
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${s.opacity})`;
        ctx.fill();
      }
    };
    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      stars = initStars(canvas.width, canvas.height);
      draw(); // image fixe garantie
    };
    resize();
    window.addEventListener("resize", resize);

    let raf = 0;
    let idle = 0;
    const loop = () => {
      if (!running()) {
        idle = window.setTimeout(() => { raf = requestAnimationFrame(loop); }, PAUSED_CHECK_MS);
        return;
      }
      for (const s of stars) {
        s.x += s.speed;
        if (s.x > canvas.width + 2) s.x = -2;
      }
      draw();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(idle);
      window.removeEventListener("resize", resize);
    };
  }, [running]);

  return <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 h-screen w-screen" />;
}
