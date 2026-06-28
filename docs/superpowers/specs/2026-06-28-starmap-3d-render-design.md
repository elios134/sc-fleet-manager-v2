# Carte stellaire — Sous-projet B : refonte du rendu 3D (full Stelliverse)

**Date** : 2026-06-28
**Statut** : design validé (en attente de relecture spec)
**Contexte parent** : refonte de la carte stellaire pour un rendu proche de la carte in-game. Sous-projet **A** (données API RSI) terminé et mergé sur `main` ; il fournit désormais les champs natifs `distance`, `longitude`, `latitude`, `appearance`, `habitable`, `subtype`, `affColor`. **B** réécrit le moteur de rendu 3D (`Starmap3D.tsx`) pour exploiter ces champs. Référence d'inspiration : Stelliverse (GitLab `drrakendu78`, AGPL-3.0) — clean-room, aucun asset ni code réutilisé.

---

## 1. Problème & objectif

Le renderer 3D actuel ([Starmap3D.tsx](../../../src/components/Starmap3D.tsx), 391 l.) dessine des **sphères colorées émissives**, des anneaux plats, des labels au survol. Il réutilise `buildSystemLayout` (logique 2D) et n'exploite ni les textures, ni la longitude orbitale, ni le LOD. Résultat : très loin de la carte in-game.

**Objectif** : réécrire le rendu 3D pour reproduire les techniques qui donnent l'allure in-game — textures procédurales par type, placement orbital fidèle (longitude + compression `sqrt` + plan écliptique tilté), glow d'étoile, halo atmosphère, ceintures, icônes jump-point, sprites à taille-écran constante et LOD (fade-in + swap icône→modèle 3D des stations).

---

## 2. Périmètre

**Inclus** :
- Plomberie : exposer les nouveaux champs RSI jusqu'au front.
- Placement orbital direct depuis `longitude`/`distance` (style Stelliverse), **découplé de `buildSystemLayout`**.
- Textures procédurales (canvas) par `appearance` : `PLANET_GREEN`, `PLANET_GAS`, `PLANET_BROWN`, `PLANET_BLUE`, fallback rocheux (`DEFAULT` / lunes).
- Glow d'étoile (sprite additif), halo atmosphère (planètes `habitable`).
- Anneaux orbitaux dans le plan écliptique tilté, ceintures (`AsteroidBelt`) en nuage de points, icônes jump-point (`Jumppoint`).
- Sprites stations/jump-points à **taille-écran constante** ; LOD : fade-in des éléments en approche, swap **icône → modèle 3D** procédural pour les stations.
- Navigation **galaxie → système → objet** conservée ; panneau info enrichi (`subtype`, `habitable`).

**Exclu (hors B)** :
- **POI de surface** (Area18, avant-postes au sol…). Stelliverse les tire de VerseTime ; cette donnée n'est pas ingérée → éventuel **sous-projet C**. B s'arrête au niveau corps / station / jump-point.
- Aucune modification du moteur 2D (`StarmapCanvas.tsx`) ni de `buildSystemLayout`.

---

## 3. Plomberie de données

### 3.1 Backend — `get_starmap_bodies` ([datamining.rs:1597](../../../src-tauri/src/commands/datamining.rs))
Ajouter au `SELECT` et au `json!{}` les colonnes : `appearance`, `habitable`, `distance`, `longitude`, `latitude`, `subtype`, `affColor`. (Colonnes créées par la migration 0031.)

### 3.2 Front — type `StarmapBodyItem` ([StarmapCanvas.tsx:10](../../../src/components/StarmapCanvas.tsx))
Étendre avec (tous optionnels / nullable, rétro-compatibles) :
```ts
appearance: string | null;
habitable: number | null;   // 0 | 1
distance: number | null;
longitude: number | null;
latitude: number | null;
subtype: string | null;
affColor: string | null;
```

---

## 4. Architecture & fichiers

Réécriture éclatée en modules focalisés sous `src/components/starmap3d/` :

| Fichier | Responsabilité | Testable |
|---|---|---|
| `placement.ts` | maths pures de placement orbital (vecteurs 3D depuis distance/longitude/latitude) | ✅ unitaire |
| `textures.ts` | générateurs `THREE.CanvasTexture` procéduraux + cache + `textureKindFor(appearance, isMoon)` | ✅ (sélection de type) |
| `primitives.tsx` | composants r3f : `Planet`, `StarGlow`, `AtmosphereHalo`, `OrbitRing`, `AsteroidBelt`, `StationSprite`, `JumpPoint`, `ProjectedLabel` | rendu (manuel) |
| `Starmap3D.tsx` | scène r3f, navigation galaxie/système/objet, HUD, panneau info | rendu (manuel) |

L'actuel `src/components/Starmap3D.tsx` est **remplacé** par un ré-export depuis `starmap3d/Starmap3D.tsx` (le `lazy(() => import("../components/Starmap3D"))` de `StarmapPage.tsx` reste inchangé).

---

## 5. Placement orbital (`placement.ts`)

Mirroir de la logique Stelliverse, alimenté par les champs RSI. Constantes : `SYS_R = 360` (rayon visuel max), `TILT = 20°`, `R_MIN = 26`, `PLANET_VR = 4.2` (rayon visuel max d'un disque planète).

```
// rayon orbital comprimé (sqrt) — d = distance du corps, maxD = distance max du système
R(d, maxD) = R_MIN + (SYS_R - R_MIN) * sqrt(d / maxD)

// plan écliptique = XZ incliné de TILT autour de X
placeOnPlane(R, lonDeg):
  a = lonDeg * π/180
  x = R*cos(a)
  z = R*sin(a)
  return (x, -z*sin(TILT), z*cos(TILT))
```
- **Planètes** : `R = R(distance, maxD)`, angle = `longitude`.
- **Lunes** : anneau autour de la planète, rayon ∝ taille planète (`pr*2.4..5`), angle = `longitude` de la lune (fallback réparti si absent), position = `parentPos + placeOnPlane(localR, lon)`.
- **Stations / jump-points** : à la position de leur parent + petit offset (anneau serré), ou au niveau étoile pour les jump-points stellaires.
- **Taille visuelle des corps** : `rv = 1.5 + (PLANET_VR-1.5)*sqrt(size/maxSize)` (planètes), lunes plus petites.

Le module expose des fonctions pures retournant des `[x,y,z]` (pas de dépendance THREE/r3f) → unit-testables. Échelle scène réutilisable telle quelle (unités three.js).

---

## 6. Textures procédurales (`textures.ts`)

Une `THREE.CanvasTexture` par type, **générée une fois et mise en cache module** (jamais `dispose`). `textureKindFor(appearance: string|null, isMoon: boolean): Kind` :
- `PLANET_GREEN` → `green` (continents + océans + nuages clairs)
- `PLANET_GAS` → `gas` (bandes horizontales + ovale tempête)
- `PLANET_BROWN` → `brown` (rocheux/désert moucheté)
- `PLANET_BLUE` → `blue` (océan/glace, dégradé froid)
- sinon / `DEFAULT` / lune → `rock` (gris cratérisé)

Chaque générateur dessine sur un canvas 512–1024, renvoie une `CanvasTexture` (sRGB, anisotropy 4). `textureFor(kind)` lit/écrit le cache. L'étoile utilise une sphère `MeshBasic` lumineuse + un sprite glow radial additif (texture radiale générée). Le halo atmosphère est un `MeshBasic` cyan additif `side: BackSide`, échelle ×1.06, affiché si `habitable === 1`.

---

## 7. Primitives r3f (`primitives.tsx`)

- `Planet` : sphère + `meshStandardMaterial` avec `map` = texture procédurale (couleur blanche) ; halo conditionnel.
- `StarGlow` : sphère `MeshBasic` + sprite glow additif.
- `OrbitRing` : ligne 128 segments dans le plan tilté (reprend l'idée actuelle, mais tiltée).
- `AsteroidBelt` : `THREE.Points` (~500 points) sur l'anneau, légère épaisseur.
- `StationSprite` : sprite icône (canvas) à taille-écran constante ; au-delà d'un seuil de zoom proche, swap vers un **modèle 3D procédural** (hub + anneau + bras), cliquable.
- `JumpPoint` : sprite icône hexagone à taille-écran constante, toujours visible.
- `ProjectedLabel` : label HTML projeté via `<Html>` de drei (déjà utilisé dans l'ancien renderer) ; visibilité pilotée selon le LOD.

Le sizing taille-écran et le fade-in LOD sont pilotés dans un `useFrame` (accès caméra) : `screenScale(d, frac) = frac*2*d*tan(fov/2)`, opacités calculées par distance caméra↔cible.

---

## 8. Interaction & navigation

- **Galaxie → Système → Objet** conservée (état `view`, boutons GLX/SYS, breadcrumb), comme l'actuel.
- Clic corps → sélection + panneau info ; corps « entrables » (avec enfants) → vue objet.
- Clic station → vol caméra + fiche.
- Hover → label + curseur pointer.
- Panneau info enrichi : `subtype`, `habitable`, `description`.

---

## 9. Tests

Unitaires (Vitest, helpers purs ; pas de rendu r3f) :
- `placement.ts` :
  - `placeOnPlane(R, 0)` → `x≈R`, `z≈0` (et `y≈0` au tilt près) ;
  - `lon=90` → `x≈0` ;
  - `y` négatif sous tilt (plan incliné) ;
  - `R(d)` monotone croissante et comprimée (sqrt) : `R(maxD)=SYS_R`, `R(0)=R_MIN`.
- `textures.ts` :
  - `textureKindFor("PLANET_GAS", false)` → `gas` ; `PLANET_GREEN`→`green` ; `PLANET_BROWN`→`brown` ; `PLANET_BLUE`→`blue` ;
  - `textureKindFor("DEFAULT", false)` → `rock` ; `textureKindFor(null, true)` (lune) → `rock`.

Les générateurs canvas et les composants r3f se valident **visuellement** (lancement de l'app, vue 3D) — pas de test snapshot.

---

## 10. Décisions par défaut

- Placement **direct** depuis `longitude`/`distance` (découplé de la 2D `buildSystemLayout`).
- **POI de surface exclus** (pas de donnée) → futur sous-projet C.
- Rewrite **éclaté en 4 modules** sous `starmap3d/`.
- **5 types de texture** procédurale (green/gas/brown/blue/rock).
- On reste en **r3f / @react-three/fiber** (pas de passage à du three.js impératif).

---

## 11. Risques

- **Champs manquants** : certains corps peuvent avoir `longitude`/`distance` à `null` (datamining/Wiki résiduel). Fallback : placement schématique (répartition d'angles, rayon par `orbitOrder`) — déjà présent dans l'ancien code, à conserver comme repli.
- **Perf textures** : 5 canvas générés au montage. Mitigé par cache module + génération paresseuse (au premier usage d'un type).
- **Régression 2D** : nulle par construction (B ne touche ni `StarmapCanvas` ni `buildSystemLayout` ni `bodyColor`).
- **Lunes sans `longitude`** : beaucoup de SATELLITE ont des champs orbitaux peu fiables → fallback de répartition angulaire indispensable (couvert par le risque champs-manquants).
