// Réglage commun du chargeur glTF des vaisseaux (viewer et Visite) : décodeur meshopt (géométrie
// compressée par asset-3d) et décodeur KTX2/Basis (textures qui restent compressées dans la carte
// graphique). Le décodeur Basis (public/basis/, copié de three) tourne dans un worker.
import type * as THREE from "three";
import { KTX2Loader, MeshoptDecoder, type GLTFLoader } from "three-stdlib";

let ktx2: KTX2Loader | null = null;

/** Extension de chargeur pour `useGLTF(url, false, false, extendShipLoader(gl))`. */
export function extendShipLoader(gl: THREE.WebGLRenderer) {
  return (loader: GLTFLoader) => {
    // MeshoptDecoder de three-stdlib est une FACTORY : il faut l'appeler pour obtenir le décodeur.
    loader.setMeshoptDecoder(MeshoptDecoder());
    ktx2 ??= new KTX2Loader().setTranscoderPath(`${import.meta.env.BASE_URL}basis/`).detectSupport(gl);
    loader.setKTX2Loader(ktx2);
  };
}
