import { Suspense, useEffect, useRef, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import * as THREE from "three";
import { Canvas, useThree } from "@react-three/fiber";
import { PointerLockControls } from "@react-three/drei";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { TFunction } from "i18next";
import { type ShipLightDef } from "../../lib/ship3dLights";
import { WalkModel } from "./WalkModel";
import { ShipLights } from "./ShipLights";

/* Mode « Visite » : parcours 1re personne de l'intérieur d'un vaisseau, avec COLLISION
   (on marche sur les planchers, les murs bloquent). Générique sur toute la flotte :
   • SPAWN AUTO : raycast pour trouver la plus grande pièce (hauteur libre) et y poser le joueur.
   • PORTES franchissables (fermées de base dans l'export) : exclues de la collision + masquées.
   • DÉPLACEMENT VERTICAL ASSISTÉ (Espace/Shift) pour les échelles et le multi-pont.
   Collision capsule vs BVH (three-mesh-bvh). Le maillage est quantifié (KHR_mesh_quantization
   via meshopt) → on lit chaque sommet dé-normalisé puis matrice monde avant de fusionner. */

// Environnement IBL neutre (procédural, offline-safe) → les surfaces PBR/métalliques de
// l'intérieur ne rendent plus NOIRES (sans envMap, le métal ne réfléchit rien). Intensité
// modérée : éclaire uniformément sans « bulle » brillante. Combiné à l'ACES du Canvas, ça
// remonte les basses lumières comme en vue extérieure — sans toucher aux émissifs.
function VisiteEnv() {
  const { scene, gl } = useThree();
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.5).texture;
    scene.environment = envTex;
    scene.environmentIntensity = 0.5;
    return () => {
      scene.environment = null;
      scene.environmentIntensity = 1;
      envTex.dispose();
      pmrem.dispose();
    };
  }, [scene, gl]);
  return null;
}

export default function ShipWalk({
  modelUrl,
  t,
  onExit,
  keepMaterials = false,
  lights = null,
}: {
  modelUrl: string;
  t: TFunction;
  onExit: () => void;
  keepMaterials?: boolean;
  /** Sidecar lumières du vaisseau (null = pas encore publié → éclairage générique seul). */
  lights?: ShipLightDef[] | null;
}) {
  // Plein écran de la Visite (sur le conteneur ShipWalk lui-même). Un listener suit l'état car on
  // peut en sortir par Échap/OS sans repasser par le bouton.
  const rootRef = useRef<HTMLDivElement>(null);
  const [isFs, setIsFs] = useState(false);
  useEffect(() => {
    const onFs = () => setIsFs(document.fullscreenElement === rootRef.current);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);
  const toggleFs = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void rootRef.current?.requestFullscreen?.();
  };
  return (
    // Wrapper et Canvas TRANSPARENTS : le fond de la scène est le vrai fond de l'app
    // (glow teinté + étoiles animées de Layout), visible à travers les trous des
    // intérieurs (pas étanches) — même ambiance que le reste de l'app.
    <div ref={rootRef} className="absolute inset-0 z-20">
      <Canvas
        camera={{ fov: 75, near: 0.03, far: 3000, position: [0, 0, 6] }}
        gl={{ toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
      >
        {/* IBL doux (fill omnidirectionnel) + ACES (remonte les ombres) — cf. VisiteEnv.
            Les 3 lumières restent pour le relief ; le casque d'appoint garantit la vue devant. */}
        <VisiteEnv />
        <hemisphereLight args={["#e6e9ff", "#2a2a35", 1.1]} />
        <ambientLight intensity={0.35} />
        <directionalLight position={[2, 4, 2]} intensity={1.0} />
        <Suspense fallback={null}>
          <WalkModel url={modelUrl} keepMaterials={keepMaterials} />
        </Suspense>
        {lights && lights.length > 0 && <ShipLights lights={lights} />}
        <PointerLockControls onUnlock={onExit} />
      </Canvas>

      <div className="pointer-events-none absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/70" />

      <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
        <div className="rounded-full bg-black/60 px-4 py-1.5 text-xs text-white/80 backdrop-blur">
          {t("ship3d.walkHint")}
        </div>
      </div>
      <div className="absolute right-4 top-4 z-30 flex items-center gap-2">
        <button
          onClick={toggleFs}
          title={t("ship3d.fullscreen")}
          aria-label={t("ship3d.fullscreen")}
          className="flex items-center justify-center rounded-lg bg-white/10 p-1.5 text-white/80 hover:bg-white/20"
        >
          {isFs ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
        <button
          onClick={onExit}
          className="rounded-lg bg-white/10 px-3 py-1.5 text-xs text-white/80 hover:bg-white/20"
        >
          {t("ship3d.walkExit")}
        </button>
      </div>
    </div>
  );
}
