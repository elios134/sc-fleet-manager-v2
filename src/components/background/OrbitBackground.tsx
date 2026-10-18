// Fond animé global « Orbite au crépuscule » (WebGL). Remplace l'ancien fond étoilé.
// Rendu à 0,55× la résolution (le fond passe sous du verre flouté), ≤ 40 i/s, en pause si
// la fenêtre est cachée, si le jeu tourne (Game.log frais) ou si l'utilisateur a coupé
// l'animation : une image fixe reste alors affichée.
import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { shouldAnimate } from "./animate";
import { ORBITE_FALLBACK, ORBITE_FRAG } from "./themes/orbite";

const SCALE = 0.55;
const FRAME_MS = 25;
const LOG_POLL_MS = 15_000;
const VERT = "attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }";

type GameLogStatus = { logAgeSecs: number | null };

export function OrbitBackground({ enabled }: { enabled: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { antialias: false, alpha: false });
    if (!gl) {
      canvas.style.background = ORBITE_FALLBACK;
      return;
    }
    const shader = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, ORBITE_FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      canvas.style.background = ORBITE_FALLBACK;
      return;
    }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "a");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const uR = gl.getUniformLocation(prog, "R");
    const uT = gl.getUniformLocation(prog, "T");

    const t0 = performance.now();
    const draw = (now: number) => {
      const w = Math.max(1, Math.floor(window.innerWidth * SCALE));
      const h = Math.max(1, Math.floor(window.innerHeight * SCALE));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
      gl.uniform2f(uR, w, h);
      gl.uniform1f(uT, (now - t0) / 1000 + 12);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    draw(performance.now()); // image fixe garantie

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let logAgeSecs: number | null = null;
    const pollLog = () => {
      invoke<GameLogStatus>("get_gamelog_status")
        .then((s) => { logAgeSecs = s.logAgeSecs ?? null; })
        .catch(() => { logAgeSecs = null; });
    };
    pollLog();
    const poll = window.setInterval(pollLog, LOG_POLL_MS);

    let raf = 0;
    let last = 0;
    const loop = (now: number) => {
      const run = shouldAnimate({ hidden: document.hidden, reducedMotion: reduced.matches, enabled: enabledRef.current, logAgeSecs });
      if (run && now - last > FRAME_MS) {
        draw(now);
        last = now;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const onResize = () => draw(performance.now());
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(poll);
      window.removeEventListener("resize", onResize);
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
    };
  }, []);

  return (
    <>
      <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 h-screen w-screen" />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0"
        style={{ background: "linear-gradient(90deg, rgba(10,10,15,0.6), rgba(10,10,15,0.2) 60%, rgba(10,10,15,0.05))" }}
      />
    </>
  );
}
