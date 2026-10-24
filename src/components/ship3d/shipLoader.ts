// Réglage commun du chargeur glTF des vaisseaux (viewer et Visite) : décodeur meshopt (géométrie
// compressée par asset-3d). Rendus clay et peint : aucune texture à décoder.
import { MeshoptDecoder, type GLTFLoader } from "three-stdlib";

/** Extension de chargeur pour `useGLTF(url, false, false, extendShipLoader)`. */
export function extendShipLoader(loader: GLTFLoader) {
  // MeshoptDecoder de three-stdlib est une FACTORY : il faut l'appeler pour obtenir le décodeur.
  loader.setMeshoptDecoder(MeshoptDecoder());
}
