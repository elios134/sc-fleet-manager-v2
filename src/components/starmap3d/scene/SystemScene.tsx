import type { ThreeEvent } from "@react-three/fiber";
import { TexturedPlanet, StarSphere, OrbitRing, AsteroidBelt, IconSprite, Station, BodyLabel } from "../primitives";
import { Asteroid } from "./Asteroid";
import { TILT, type Placed } from "../layout";
import { bodyKey } from "../naming";
import { safeName } from "../starmapData";
import type { Layers } from "../view";

// Corps rocheux irréguliers sans texture équirect (rendus en modèle procédural à cratère).
const ASTEROID_KEYS = new Set(["delamar"]);

/** Vue système (ou vue globe d'un corps) : étoile, anneaux, planètes, lunes, stations,
 *  ceintures, jump points ; filtrés par calques. `focusId` reste visible quel que soit le calque. */
export function SystemScene({
  shown,
  rings,
  layers,
  selectedId,
  focusId,
  onPick,
}: {
  shown: Placed[];
  rings: Float32Array[];
  layers: Layers;
  selectedId: string | null;
  focusId: string | null;
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
        if (p.kind === "star") return <StarSphere key={p.body.id} position={p.pos} radius={p.radius} />;
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
    </>
  );
}
