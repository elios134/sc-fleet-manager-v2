import type { ThreeEvent } from "@react-three/fiber";
import { Billboard } from "@react-three/drei";
import { TexturedPlanet, StarSphere, OrbitRing, AsteroidBelt, IconSprite, Station, BodyLabel } from "../primitives";
import { Asteroid } from "./Asteroid";
import { TILT, type Placed } from "../layout";
import { bodyKey } from "../naming";
import { safeName } from "../starmapData";
import type { Layers } from "../view";

// Corps rocheux irréguliers sans texture équirect (rendus en modèle procédural à cratère).
const ASTEROID_KEYS = new Set(["delamar"]);

/** Repère « vous êtes ici » (lieu du Game.log) : anneau vert toujours face caméra. */
function HereMarker({ position, radius }: { position: [number, number, number]; radius: number }) {
  const r = Math.max(radius, 2.5);
  return (
    <Billboard position={position}>
      <mesh renderOrder={10}>
        <ringGeometry args={[r * 1.7, r * 1.95, 48]} />
        <meshBasicMaterial color="#34d399" transparent opacity={0.9} depthTest={false} />
      </mesh>
    </Billboard>
  );
}

/** Vue système (ou vue globe d'un corps) : étoile, anneaux, planètes, lunes, stations,
 *  ceintures, jump points ; filtrés par calques. `focusId` reste visible quel que soit le calque. */
export function SystemScene({
  shown,
  rings,
  layers,
  selectedId,
  focusId,
  hereId,
  onPick,
}: {
  shown: Placed[];
  rings: Float32Array[];
  layers: Layers;
  selectedId: string | null;
  focusId: string | null;
  /** Corps où se trouve le joueur (Game.log), marqué d'un anneau. */
  hereId: string | null;
  onPick: (p: Placed) => void;
}) {
  const pick = (p: Placed) => (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onPick(p);
  };
  return (
    <>
      {rings.map((pts, i) => (
        <OrbitRing key={`ring${i}`} points={pts} />
      ))}
      {shown.map((p) => {
        if (p.kind === "star") return <StarSphere key={p.body.id} position={p.pos} radius={p.radius} lit={layers.light} />;
        if (p.kind === "belt") return layers.belts ? <AsteroidBelt key={p.body.id} radius={p.ringR ?? 100} tilt={TILT} /> : null;
        if (p.kind === "jump")
          return layers.jumps ? <IconSprite key={p.body.id} position={p.pos} kind="jump" frac={0.045} onClick={pick(p)} /> : null;
        if (p.kind === "station")
          return layers.stations ? <Station key={p.body.id} position={p.pos} frac={0.03} onClick={pick(p)} /> : null;
        // Calque Lunes : vue système seulement (en vue globe, les lunes du corps restent visibles).
        if (p.kind === "moon" && !layers.moons && focusId === null) return null;
        const isAsteroid = ASTEROID_KEYS.has(bodyKey(safeName(p.body)));
        return (
          <group key={p.body.id}>
            {isAsteroid ? (
              <group onClick={pick(p)}>
                <Asteroid position={p.pos} radius={p.radius} />
              </group>
            ) : (
              <TexturedPlanet
                name={safeName(p.body)}
                position={p.pos}
                radius={p.radius}
                appearance={p.body.appearance}
                habitable={p.body.habitable}
                isMoon={p.kind === "moon"}
                selected={selectedId === p.body.id}
                onClick={pick(p)}
              />
            )}
            <BodyLabel position={[p.pos[0], p.pos[1] + p.radius + 4, p.pos[2]]} text={safeName(p.body)} />
          </group>
        );
      })}
      {(() => {
        const here = hereId ? shown.find((p) => p.body.id === hereId) : undefined;
        // Corps masqué par son calque : pas d'anneau flottant dans le vide.
        const hidden =
          !here ||
          (here.kind === "station" && !layers.stations) ||
          (here.kind === "moon" && !layers.moons && focusId === null);
        return hidden ? null : <HereMarker position={here.pos} radius={here.radius} />;
      })()}
    </>
  );
}
