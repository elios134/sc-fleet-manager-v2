import { Component, Suspense, useEffect, useMemo, type ReactNode } from "react";
import * as THREE from "three";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, Html, Edges, useGLTF, Bounds, Center } from "@react-three/drei";
import { EffectComposer, Bloom, SMAA } from "@react-three/postprocessing";
import { MeshoptDecoder, type GLTFLoader } from "three-stdlib";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { TFunction } from "i18next";
import { deblackenMaterial } from "./materialFix";

// Environnement IBL neutre (procédural, offline-safe) → reflets PBR doux sur les coques.
// sigma élevé = reflets DIFFUS (pas de « bulle » brillante nette de la lampe de l'env sur le métal) ;
// environmentIntensity bas = reflets discrets, on garde l'éclairage principal aux directionnelles.
function ViewerEnv() {
  const { scene, gl } = useThree();
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.5).texture;
    scene.environment = envTex;
    scene.environmentIntensity = 0.3;
    return () => {
      scene.environment = null;
      scene.environmentIntensity = 1;
      envTex.dispose();
      pmrem.dispose();
    };
  }, [scene, gl]);
  return null;
}

/* Viewer 3D des vaisseaux (react-three-fiber), lazy-loadé.
   • Cadrage AUTOMATIQUE (Bounds + Center) → le modèle est encadré quelle que soit son
     échelle réelle. Éclairage ambiant/hémisphère fort (indépendant de l'échelle).
   • RENDU « CLAY » uniforme (les vrais matériaux sont quasi noirs → illisibles) : une même
     couleur claire pour la coque ET l'intérieur, mais 2 instances de matériau pour que
     l'OPACITÉ de la coque (parties sans « interior ») soit réglable sans toucher l'intérieur.
   • Isolation d'une partie. Zoom rapproché (near/minDistance bas) → on entre dedans. */

const TARGET = 10; // échelle du blockout (fallback)
const CLAY = 0x6f7580; // gris moyen unique (coque = intérieur), mat — pas de blanc/reflets

type Dims = { l: number; b: number; h: number };
export interface ShipPart {
  id: string;
  name: string;
  hull: boolean;
}

function isMesh(o: THREE.Object3D): o is THREE.Mesh {
  return (o as THREE.Mesh).isMesh === true;
}

function GLBModel({
  url,
  hullOpacity,
  part,
  onParts,
  keepMaterials = false,
}: {
  url: string;
  hullOpacity: number;
  part: string;
  onParts?: (parts: ShipPart[]) => void;
  keepMaterials?: boolean;
}) {
  // Les .glb extérieurs sont compressés en EXT_meshopt_compression (passe d'optim
  // gltf-transform côté asset-3d) : sans décodeur meshopt, le chargement échoue. On le
  // branche explicitement (useDraco=false, useMeshOpt=false → on gère nous-mêmes via extendLoader).
  // MeshoptDecoder de three-stdlib est une FACTORY → il faut l'APPELER (MeshoptDecoder()) pour
  // obtenir le vrai décodeur ; le passer non-appelé casse le décodage → extérieur vide.
  const { scene } = useGLTF(url, false, false, (loader: GLTFLoader) => loader.setMeshoptDecoder(MeshoptDecoder()));

  const { parts, meta, hullMat } = useMemo(() => {
    // Descend les conteneurs à enfant unique (ex. « CryEngine_Z_up ») → parties de 1er niveau.
    let container: THREE.Object3D = scene;
    while (container.children.length === 1 && !isMesh(container.children[0])) {
      container = container.children[0];
    }
    // Plus de filtre de masquage : les extérieurs sont désormais des SILHOUETTES (re-export
    // `--no-attachments` côté asset-3d) → pas d'armes/échelles/bras/primitives orphelines à cacher.
    const named = container.children.filter((o) => !!o.name);
    const list = named.length > 0 ? named : container.children;
    const meta: ShipPart[] = list.map((p) => ({ id: p.uuid, name: p.name, hull: !/interior/i.test(p.name) }));

    // Même gris mat pour tout ; 2 instances → l'opacité coque n'affecte pas l'intérieur.
    const hullMat = new THREE.MeshStandardMaterial({ color: CLAY, roughness: 0.95, metalness: 0.0 });
    const interiorMat = new THREE.MeshStandardMaterial({ color: CLAY, roughness: 1.0, metalness: 0.0, side: THREE.DoubleSide });
    // keepMaterials : on garde les vrais matériaux/textures du .glb (test des assets HD texturés)
    // au lieu du rendu clay. Le slider d'opacité coque n'a alors plus d'effet (acceptable).
    if (!keepMaterials) {
      list.forEach((p, i) => {
        const mat = meta[i].hull ? hullMat : interiorMat;
        p.traverse((o) => {
          if (isMesh(o)) o.material = mat;
        });
      });
    } else {
      // Atténue les émissifs très forts (feux, écrans, lueurs) pour éviter les blocs blancs cramés.
      scene.traverse((o) => {
        if (!isMesh(o)) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => {
          const sm = m as THREE.MeshStandardMaterial;
          deblackenMaterial(sm); // facteur ~noir qui annule l'albédo (coques Gama) → blanc/gris
          if (sm?.emissive && (sm.emissiveMap || sm.emissive.getHex() > 0)) {
            sm.emissiveIntensity = (sm.emissiveIntensity ?? 1) * 0.4;
          }
        });
      });
    }

    // Désactive les lumières embarquées du .glb (on éclaire nous-mêmes la vitrine).
    scene.traverse((o) => {
      if ((o as THREE.Light).isLight) o.visible = false;
    });

    return { parts: list, meta, hullMat };
  }, [scene, keepMaterials]);

  useEffect(() => {
    onParts?.(meta);
  }, [meta, onParts]);

  useEffect(() => {
    hullMat.transparent = hullOpacity < 1;
    hullMat.opacity = hullOpacity;
    hullMat.depthWrite = hullOpacity >= 0.98;
  }, [hullMat, hullOpacity]);

  useEffect(() => {
    parts.forEach((p) => {
      p.visible = part === "all" || p.uuid === part;
    });
  }, [parts, part]);

  return <primitive object={scene} />;
}

function OrientLabel({ pos, text }: { pos: [number, number, number]; text: string }) {
  return (
    <Html position={pos} center style={{ pointerEvents: "none" }}>
      <span className="whitespace-nowrap rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white/80">
        {text}
      </span>
    </Html>
  );
}

// Aperçu à l'échelle : boîte aux dimensions réelles (beam=x, height=y, length=z).
function Blockout({ dims, t }: { dims: Dims; t: TFunction }) {
  const maxDim = Math.max(dims.l, dims.b, dims.h) || 1;
  const sf = TARGET / maxDim;
  const w = dims.b * sf;
  const h = dims.h * sf;
  const d = dims.l * sf;
  return (
    <group>
      <mesh>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial color="#3a3357" roughness={0.75} metalness={0.1} transparent opacity={0.35} />
        <Edges threshold={15} color="#a5a7f5" />
      </mesh>
      <OrientLabel pos={[0, 0, d / 2 + 0.5]} text={t("ship3d.fore")} />
      <OrientLabel pos={[0, 0, -d / 2 - 0.5]} text={t("ship3d.aft")} />
      <OrientLabel pos={[w / 2 + 0.5, 0, 0]} text={t("ship3d.starboard")} />
      <OrientLabel pos={[-w / 2 - 0.5, 0, 0]} text={t("ship3d.port")} />
    </group>
  );
}

// Capture une erreur de chargement du .glb → affiche le fallback (blockout).
class GLBBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { err: boolean }> {
  state = { err: false };
  static getDerivedStateFromError() {
    return { err: true };
  }
  componentDidUpdate(prev: { children: ReactNode }) {
    if (prev.children !== this.props.children && this.state.err) this.setState({ err: false });
  }
  render() {
    return this.state.err ? this.props.fallback : this.props.children;
  }
}

export default function ShipViewer3D({
  modelUrl,
  dims,
  t,
  hullOpacity = 1,
  part = "all",
  onParts,
  keepMaterials = false,
}: {
  modelUrl?: string | null;
  dims: Dims | null;
  t: TFunction;
  hullOpacity?: number;
  part?: string;
  onParts?: (parts: ShipPart[]) => void;
  keepMaterials?: boolean;
}) {
  const blockout = dims ? <Blockout dims={dims} t={t} /> : null;
  return (
    <div
      className="h-full overflow-hidden rounded-2xl border border-white/10"
      style={{ background: "radial-gradient(ellipse at 50% 35%, #23202f 0%, #14121d 70%, #0b0a12 100%)" }}
    >
      <Canvas
        camera={{ position: [6, 4, 9], fov: 45, near: 0.01, far: 8000 }}
        gl={{ toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.0 }}
      >
        <ViewerEnv />
        {/* Ambiant + hémisphère de base, puis directionnelles pour le relief (l'« effet de
            lumière ») — le gris est foncé donc pas de sur-exposition en blanc. */}
        <ambientLight intensity={0.55} />
        <hemisphereLight args={["#d7dbe6", "#33333f", 0.4]} />
        <directionalLight position={[1, 2, 1.4]} intensity={1.0} />
        <directionalLight position={[-1.2, 0.6, -1]} intensity={0.45} />

        {modelUrl ? (
          <GLBBoundary fallback={blockout}>
            <Suspense fallback={blockout}>
              <Bounds fit clip observe margin={1.2}>
                <Center>
                  <GLBModel url={modelUrl} hullOpacity={hullOpacity} part={part} onParts={onParts} keepMaterials={keepMaterials} />
                </Center>
              </Bounds>
            </Suspense>
          </GLBBoundary>
        ) : (
          blockout
        )}

        {/* minDistance très bas → on peut entrer dans le vaisseau et se balader. */}
        <OrbitControls makeDefault enablePan enableDamping dampingFactor={0.1} minDistance={0.02} maxDistance={8000} />
        {/* Bloom (feux/émissifs) + SMAA (anti-aliasing).
            ⚠ frameBufferType FORCÉ en UnsignedByte : le défaut HalfFloatType de
            @react-three/postprocessing rend un écran NOIR (parfois scintillant) sur certains
            GPU/drivers Windows (reproduit et isolé au harnais : HalfFloat seul → 100 % noir,
            UnsignedByte → parfait). Bloom LDR suffit ici (seuil 0.92, intensité 0.25).
            multisampling=0 : le MSAA est redondant avec SMAA (et coûteux). */}
        <EffectComposer multisampling={0} frameBufferType={THREE.UnsignedByteType}>
          <Bloom mipmapBlur luminanceThreshold={0.92} luminanceSmoothing={0.2} intensity={0.25} />
          <SMAA />
        </EffectComposer>
      </Canvas>
    </div>
  );
}
