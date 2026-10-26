// Fond « Vortex cosmique » (WebGL) : l'image telle quelle, sans zoom, dont le tourbillon tourne
// (shader.ts). Pleine résolution, ≤ 40 i/s, en pause si la fenêtre est cachée, si le jeu tourne
// (Game.log frais) ou si l'utilisateur a coupé l'animation : une image fixe reste alors affichée.
import { useEffect, useRef } from "react";
import { useAnimationGate } from "./useAnimationGate";
import { BG_FRAG } from "./themes/shader";
import { VORTEX_FALLBACK_CSS, VORTEX_IMAGE } from "./themes/images";
import { VORTEX } from "./themes/backgrounds";

const SCALE = 1;
const FRAME_MS = 25;
const PAUSED_CHECK_MS = 1_000;
const VERT = "attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }";

export function VortexBackground({ enabled }: { enabled: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const running = useAnimationGate(enabled);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const VORTEX_FALLBACK = VORTEX_FALLBACK_CSS;
    canvas.style.background = "";
    const gl = canvas.getContext("webgl", { antialias: false, alpha: false });
    if (!gl) {
      canvas.style.background = VORTEX_FALLBACK;
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
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, BG_FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      canvas.style.background = VORTEX_FALLBACK;
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
    const uIMG = gl.getUniformLocation(prog, "IMG");
    // Cadrage et tourbillon du vortex.
    gl.uniform2f(gl.getUniformLocation(prog, "FOCUS"), VORTEX.focus[0], VORTEX.focus[1]);
    gl.uniform2f(gl.getUniformLocation(prog, "CORE"), VORTEX.core[0], VORTEX.core[1]);
    gl.uniform1f(gl.getUniformLocation(prog, "RADIUS"), VORTEX.radius);
    gl.uniform2f(gl.getUniformLocation(prog, "SQUASH"), VORTEX.squash[0], VORTEX.squash[1]);
    gl.uniform1f(gl.getUniformLocation(prog, "AMP"), VORTEX.amp);
    const tex = gl.createTexture();
    let ready = false;

    const t0 = performance.now();
    const draw = (now: number) => {
      if (!ready) return;
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
    const img = new Image();
    img.onload = () => {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.uniform2f(uIMG, img.naturalWidth, img.naturalHeight);
      ready = true;
      draw(performance.now()); // image fixe garantie
    };
    img.onerror = () => { canvas.style.background = VORTEX_FALLBACK; };
    img.src = VORTEX_IMAGE;

    // Animation : rAF à ≤ 40 i/s. En pause (jeu lancé, fenêtre cachée, réglage coupé), plus de
    // rAF : l'état est revérifié une fois par seconde, la dernière image reste affichée.
    let raf = 0;
    let idle = 0;
    let last = 0;
    let lost = false;
    const loop = (now: number) => {
      if (lost) return;
      if (!running()) {
        idle = window.setTimeout(() => { raf = requestAnimationFrame(loop); }, PAUSED_CHECK_MS);
        return;
      }
      if (now - last > FRAME_MS) {
        draw(now);
        last = now;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const onResize = () => draw(performance.now());
    window.addEventListener("resize", onResize);
    // Reset pilote / pression GPU (souvent au lancement du jeu) : on bascule sur l'image fixe.
    const onLost = (e: Event) => {
      e.preventDefault();
      ready = false;
      lost = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(idle);
      canvas.style.background = VORTEX_FALLBACK;
    };
    canvas.addEventListener("webglcontextlost", onLost);

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(idle);
      window.removeEventListener("resize", onResize);
      canvas.removeEventListener("webglcontextlost", onLost);
      img.onload = null;
      gl.deleteTexture(tex);
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
    };
  }, [running]);

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
