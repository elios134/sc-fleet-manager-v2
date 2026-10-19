// Orchestrateur de la scène 3D de la carte : <Canvas>, scènes galaxie / système, couche
// surface, LOD, caméra. Aucune UI DOM (rail, barre haute et fiche sont posés par la page).
import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Stars } from "@react-three/drei";
import * as THREE from "three";
import { CameraFocus } from "./CameraFocus";
import { safeName, type StarmapBodyItem, type GeoData, type GeoPoi } from "./starmapData";
import { lodLevelFor, sunDirection, surfacePoint, type Vec3 } from "./placement";
import { bodyKey } from "./naming";
import { SurfaceLayer } from "./scene/SurfaceLayer";
import { GalaxyScene } from "./scene/GalaxyScene";
import { SystemScene } from "./scene/SystemScene";
import { InvalidatePump } from "./scene/InvalidatePump";
import { bodyJoinKey, parentJoinKey } from "./panel";
import { layoutSystem, ringPoints, type Placed } from "./layout";
import type { StarmapNav } from "./useStarmapView";
import { focusFor, selectionFlight } from "./view";

// TripMap3D (carte GPS de Cargo) importe ces helpers d'ici.
export { layoutSystem, ringPoints, bodyJoinKey, parentJoinKey };

/** Suit la distance caméra→corps ciblé et remonte le niveau LOD (far/body/surface). */
function LodTracker({
  target,
  radius,
  onLevel,
}: {
  target: Vec3 | null;
  radius: number;
  onLevel: (l: "far" | "body" | "surface") => void;
}) {
  const { camera } = useThree();
  // null au montage : le niveau est toujours remonté une 1re fois (sinon un « surface » resté
  // d'une scène précédente survit au remontage du Canvas).
  const last = useRef<"far" | "body" | "surface" | null>(null);
  const v = useRef(new THREE.Vector3());
  useFrame(() => {
    if (!target) {
      if (last.current !== "far") {
        last.current = "far";
        onLevel("far");
      }
      return;
    }
    v.current.set(target[0], target[1], target[2]);
    const d = camera.position.distanceTo(v.current);
    const lvl = lodLevelFor(d, radius);
    if (lvl !== last.current) {
      last.current = lvl;
      onLevel(lvl);
    }
  });
  return null;
}

export default function Starmap3D({ bodies, geo, nav }: { bodies: StarmapBodyItem[]; geo: GeoData; nav: StarmapNav }) {
  const { state, dispatch, layers, lod, setLod, camFocus, focusOn } = nav;
  const view = state.view;
  const [hoveredPoi, setHoveredPoi] = useState<string | null>(null);
  // Perte de contexte WebGL (SC accapare le GPU) → on remonte la scène à l'état courant.
  const [reloadNonce, setReloadNonce] = useState(0);

  // Index géométrie par clé de corps + POI groupés par corps parent.
  const geoByKey = useMemo(() => new Map(geo.bodies.map((b) => [bodyKey(b.name), b])), [geo]);
  const poisByParent = useMemo(() => {
    const m = new Map<string, GeoPoi[]>();
    for (const p of geo.pois) {
      const k = bodyKey(p.parentBody);
      const arr = m.get(k);
      if (arr) arr.push(p);
      else m.set(k, [p]);
    }
    return m;
  }, [geo]);

  const placed = useMemo(() => (view.level !== "galaxy" ? layoutSystem(bodies, view.systemId) : []), [bodies, view]);

  // Vue objet : corps focalisé à l'origine, enfants en relatif.
  const shown = useMemo(() => {
    if (view.level !== "object") return placed;
    const focusBody = placed.find((p) => p.body.id === view.bodyId);
    if (!focusBody) return placed;
    const kids = placed.filter((p) => parentJoinKey(p.body) === bodyJoinKey(focusBody.body));
    return [
      { ...focusBody, pos: [0, 0, 0] as Vec3 },
      ...kids.map((kch) => ({
        ...kch,
        pos: [kch.pos[0] - focusBody.pos[0], kch.pos[1] - focusBody.pos[1], kch.pos[2] - focusBody.pos[2]] as Vec3,
      })),
    ];
  }, [placed, view]);

  // Anneaux : héliocentriques (planètes) en vue système ; planétocentriques (lunes) en vue objet.
  const rings = useMemo(() => {
    if (view.level === "system")
      return shown.filter((p) => p.kind === "planet" && p.ringR != null).map((p) => ringPoints(p.ringR!));
    if (view.level === "object")
      return shown.filter((p) => p.kind === "moon" && p.ringR != null).map((p) => ringPoints(p.ringR!));
    return [];
  }, [shown, view.level]);

  // Corps ciblé parmi les corps rendus → cible LOD + surface.
  const selPlaced = useMemo(
    () => (state.selectedId ? shown.find((p) => p.body.id === state.selectedId) ?? null : null),
    [shown, state.selectedId],
  );
  const selKey = selPlaced ? bodyKey(safeName(selPlaced.body)) : "";
  const surfaceEligible = !!selPlaced && (selPlaced.kind === "planet" || selPlaced.kind === "moon");

  const camPos: Vec3 = view.level === "galaxy" ? [0, 220, 300] : view.level === "object" ? [0, 14, 22] : [0, 240, 360];
  const camKey = view.level === "galaxy" ? "galaxy" : view.level === "object" ? `obj:${view.bodyId}` : `sys:${view.systemId}`;
  const focusId = view.level === "object" ? view.bodyId : null;
  // Vue globe : l'étoile n'est pas rendue → lumière directionnelle venant de sa direction.
  const sunDir = useMemo(() => {
    if (!focusId) return null;
    const f = placed.find((p) => p.body.id === focusId);
    return f ? sunDirection(f.pos, placed.find((p) => p.kind === "star")?.pos ?? null) : null;
  }, [placed, focusId]);
  // Sélection (scène ou rail) → vol vers le corps ; pas de vol pour le corps au centre du globe.
  useEffect(() => {
    const f = selectionFlight(view.level, state.selectedId, focusId);
    if (f != null && selPlaced) focusOn(camKey, selPlaced.pos, selPlaced.radius, f);
  }, [state.selectedId, camKey, selPlaced?.body.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // POI choisi (globe ou fiche) → caméra recentrée sur ce point de la surface ; retour au
  // corps quand le POI est quitté (fil d'Ariane).
  const poiName = state.poi;
  useEffect(() => {
    if (view.level !== "object" || !selPlaced) return;
    const poi = poiName ? (poisByParent.get(selKey) ?? []).find((p) => p.name === poiName) : null;
    if (!poi) {
      if (!poiName) focusOn(camKey, selPlaced.pos, selPlaced.radius, 2); // ≤ 2,2 r : LOD surface, POI visibles
      return;
    }
    // Caméra au-dessus du POI (normale sortante), visée sur le centre du corps.
    const n = surfacePoint(poi.coord, geoByKey.get(selKey)?.rotationCorrection ?? 0, 1);
    focusOn(camKey, selPlaced.pos, selPlaced.radius, 1.9, n);
  }, [poiName, view.level, selKey]); // eslint-disable-line react-hooks/exhaustive-deps


  // Clic sur un corps → sélection (2e clic sur une planète/lune = approche) + vol caméra.
  // Le vol suit l'effet de sélection. En vue globe, tout corps rendu est le corps focalisé
  // ou un de ses enfants.
  function onPick(p: Placed) {
    dispatch({ type: "select", body: p.body, childOfFocus: view.level === "object" });
  }
  const focus = focusFor(camFocus, camKey);

  return (
    // Fond opaque : sans lui, le fond animé de l'app transparaît derrière la scène 3D.
    <div className="absolute inset-0 bg-[var(--background)]">
      <Canvas
        key={`${camKey}:${reloadNonce}`}
        frameloop="demand"
        dpr={[1, 1.75]}
        performance={{ min: 0.5 }}
        camera={{ position: camPos, fov: 50, far: 8000 }}
        onPointerMissed={() => dispatch({ type: "clear" })}
        onCreated={({ gl }) => {
          const el = gl.domElement;
          el.addEventListener("webglcontextlost", (e) => e.preventDefault());
          el.addEventListener("webglcontextrestored", () => setReloadNonce((n) => n + 1));
        }}
      >
        <color attach="background" args={["#05060a"]} />
        {/* Calque Éclairage coupé : corps éclairés uniformément (pas de côté nuit). */}
        <ambientLight intensity={layers.light ? (sunDir ? 0.22 : 0.34) : 1.5} />
        {layers.light && sunDir && (
          <directionalLight position={[sunDir[0] * 100, sunDir[1] * 100, sunDir[2] * 100]} intensity={2.4} />
        )}
        <Stars radius={2000} depth={400} count={3000} factor={6} fade speed={0.3} />

        {view.level === "galaxy" ? (
          <GalaxyScene bodies={bodies} onSystem={(id) => dispatch({ type: "system", systemId: id })} />
        ) : (
          <SystemScene
            shown={shown}
            rings={rings}
            layers={layers}
            selectedId={state.selectedId}
            focusId={focusId}
            onPick={onPick}
          />
        )}

        {surfaceEligible && selPlaced && (
          <group position={selPlaced.pos}>
            <SurfaceLayer
              pois={poisByParent.get(selKey) ?? []}
              globeRadius={selPlaced.radius}
              rotationCorrection={geoByKey.get(selKey)?.rotationCorrection ?? 0}
              visible={lod === "surface" && layers.poi}
              onHover={setHoveredPoi}
              onPick={(name) => dispatch({ type: "poi", name })}
            />
          </group>
        )}
        <LodTracker target={selPlaced?.pos ?? null} radius={selPlaced?.radius ?? 1} onLevel={setLod} />
        <InvalidatePump trigger={focus?.nonce ?? lod} />

        <OrbitControls makeDefault regress enablePan enableDamping dampingFactor={0.1} minDistance={3} maxDistance={2000} />
        <CameraFocus target={focus} />
      </Canvas>

      {hoveredPoi && lod === "surface" && (
        <div className="pointer-events-none absolute bottom-20 left-1/2 -translate-x-1/2 rounded-full border border-white/15 bg-black/70 px-3 py-1 font-mono text-[11px] text-white/90 backdrop-blur">
          {hoveredPoi}
        </div>
      )}
    </div>
  );
}
