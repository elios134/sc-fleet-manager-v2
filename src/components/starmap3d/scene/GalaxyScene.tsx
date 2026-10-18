import { useMemo } from "react";
import { BodyLabel } from "../primitives";
import { galaxyData } from "../layout";
import type { StarmapBodyItem } from "../starmapData";

/** Vue galaxie : un nœud par système, liens de saut ; clic → vue système. */
export function GalaxyScene({ bodies, onSystem }: { bodies: StarmapBodyItem[]; onSystem: (id: string) => void }) {
  const galaxy = useMemo(() => galaxyData(bodies), [bodies]);
  return (
    <>
      {galaxy.links.map((l, i) => (
        <line key={`lk${i}`}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[new Float32Array([...l[0], ...l[1]]), 3]} />
          </bufferGeometry>
          <lineBasicMaterial color="#f5a623" transparent opacity={0.35} />
        </line>
      ))}
      {galaxy.nodes.map((s) => (
        <group
          key={s.id}
          position={s.pos}
          onClick={(e) => {
            e.stopPropagation();
            onSystem(s.id);
          }}
        >
          <mesh>
            <sphereGeometry args={[5, 24, 24]} />
            <meshBasicMaterial color={s.color} />
          </mesh>
          <pointLight intensity={1.2} distance={120} decay={0} color={s.color} />
          <BodyLabel position={[0, 8, 0]} text={s.name} />
        </group>
      ))}
    </>
  );
}
