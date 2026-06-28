// Carte 3D — refonte sous-projet B. L'implémentation vit dans starmap3d/ (modules
// focalisés : placement, textures, primitives, scène). Ce ré-export préserve le
// chemin d'import existant (lazy(() => import("../components/Starmap3D")) côté page).
export { default } from "./starmap3d/Starmap3D";
