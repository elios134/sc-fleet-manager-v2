import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { GeoPoi } from "../starmapData";
import { surfacePoint, type Vec3 } from "../placement";
import { screenScale } from "../primitives";
import { poiKind, poiIconTexture, type PoiKind } from "../poiIcons";

/** Sprite POI à taille-écran constante (icône par type). */
function PoiSprite({ pos, kind, frac = 0.022 }: { pos: Vec3; kind: PoiKind; frac?: number }) {
  const ref = useRef<THREE.Sprite>(null);
  const tex = useMemo(() => poiIconTexture(kind), [kind]);
  const { camera } = useThree();
  useFrame(() => {
    const s = ref.current;
    if (!s) return;
    const d = camera.position.distanceTo(s.position);
    const fov = (camera as THREE.PerspectiveCamera).fov ?? 50;
    const sc = screenScale(d, frac, fov);
    s.scale.set(sc, sc, 1);
  });
  return (
    <sprite ref={ref} position={pos}>
      <spriteMaterial map={tex} transparent depthTest={false} />
    </sprite>
  );
}

/** Couche surface : POI posés en lon/lat sur le globe, visibles seulement en LOD surface.
    Chargée lazy (uniquement pour le corps ciblé) par l'orchestrateur. */
export function SurfaceLayer({
  pois,
  globeRadius,
  rotationCorrection,
  visible,
  onHover,
  onPick,
}: {
  pois: GeoPoi[];
  globeRadius: number;
  rotationCorrection: number;
  visible: boolean;
  onHover: (name: string | null) => void;
  onPick?: (name: string) => void;
}) {
  const placed = useMemo(
    () => pois.map((p) => ({ p, pos: surfacePoint(p.coord, rotationCorrection, globeRadius * 1.01) })),
    [pois, rotationCorrection, globeRadius],
  );
  if (!visible) return null;
  return (
    <group>
      {placed.map(({ p, pos }) => (
        <group
          key={p.name}
          onPointerOver={(e) => {
            e.stopPropagation();
            onHover(p.name);
          }}
          onPointerOut={() => onHover(null)}
          onClick={(e) => {
            e.stopPropagation();
            onPick?.(p.name);
          }}
        >
          <PoiSprite pos={pos} kind={poiKind(p.type)} />
        </group>
      ))}
    </group>
  );
}
