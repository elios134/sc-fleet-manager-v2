# Starmap 3D Render Refonte — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Réécrire le rendu 3D de la carte stellaire pour une allure proche de l'in-game : textures procédurales par type, placement orbital fidèle (longitude + sqrt + plan écliptique tilté), glow/halo/ceintures/jump-points, sprites à taille-écran constante + LOD.

**Architecture:** Réécriture éclatée sous `src/components/starmap3d/` : `placement.ts` (maths pures testées), `textures.ts` (générateurs canvas + sélection de type testée), `primitives.tsx` (composants r3f), `Starmap3D.tsx` (scène + nav). Alimenté par les champs RSI de A (longitude/distance/appearance/habitable), exposés jusqu'au front via `get_starmap_bodies`. Découplé de `buildSystemLayout` / `StarmapCanvas` (2D intacte).

**Tech Stack:** React + TypeScript, @react-three/fiber 9, @react-three/drei 10, three 0.180, Vitest (nouveau, pour les helpers purs), Rust/sqlx (plomberie données).

## Global Constraints

- **Clean-room** : aucune réutilisation de code/asset Stelliverse (AGPL).
- **2D intacte** : ne PAS modifier `StarmapCanvas.tsx`, `buildSystemLayout`, `bodyColor`.
- **POI de surface hors périmètre** (pas de donnée).
- **Constantes placement** : `SYS_R = 360`, `R_MIN = 26`, `TILT = 20°`, `PLANET_VR = 4.2`.
- **Types de texture** : `green` (PLANET_GREEN), `gas` (PLANET_GAS), `brown` (PLANET_BROWN), `blue` (PLANET_BLUE), `rock` (DEFAULT / fallback / lunes).
- **Repli placement** : corps sans `longitude`/`distance` → placement schématique (angle réparti, rayon par `orbitOrder`).
- **Tests front** : Vitest en devDep, isolé du build de prod (`tsconfig` exclut `*.test.ts`).

---

## File Structure

- `src-tauri/src/commands/datamining.rs` — **modifié** : `get_starmap_bodies` renvoie les 7 nouveaux champs.
- `src/components/StarmapCanvas.tsx` — **modifié** : type `StarmapBodyItem` étendu (7 champs). (Aucune autre ligne touchée.)
- `package.json`, `vitest.config.ts`, `tsconfig.json` — **modifiés/créés** : infra Vitest.
- `src/components/starmap3d/placement.ts` — **créé** : maths pures.
- `src/components/starmap3d/placement.test.ts` — **créé** : tests.
- `src/components/starmap3d/textures.ts` — **créé** : générateurs canvas + `textureKindFor`.
- `src/components/starmap3d/textures.test.ts` — **créé** : tests de `textureKindFor`.
- `src/components/starmap3d/primitives.tsx` — **créé** : composants r3f.
- `src/components/starmap3d/Starmap3D.tsx` — **créé** : scène + nav.
- `src/components/Starmap3D.tsx` — **remplacé** : ré-export `export { default } from "./starmap3d/Starmap3D";`.

---

## Task 1: Plomberie de données (Rust + type TS)

**Files:**
- Modify: `src-tauri/src/commands/datamining.rs` (fn `get_starmap_bodies`, ~1605-1638)
- Modify: `src/components/StarmapCanvas.tsx` (type `StarmapBodyItem`, lignes 10-28)

**Interfaces:**
- Produces: les corps renvoyés par `get_starmap_bodies` portent `appearance, habitable, distance, longitude, latitude, subtype, affColor`. Type TS `StarmapBodyItem` étendu en conséquence.

- [ ] **Step 1: Étendre le SELECT + json! Rust**

Dans `get_starmap_bodies`, remplacer la requête et l'objet json :

```rust
    let rows = sqlx::query(
        "SELECT id, recordName, systemName, navIcon, name, description, size, parentRef,
                hideInStarmap, showOrbitLine, orbitOrder, source, lastSyncedAt, posX, posY, posZ, wikiUuid,
                appearance, habitable, distance, longitude, latitude, subtype, affColor
         FROM StarmapBody
         ORDER BY systemName ASC, orbitOrder ASC, navIcon ASC, name ASC",
    )
```

et ajouter, dans le `json!{}`, après `"wikiUuid": ...,` :

```rust
                "appearance": r.try_get::<Option<String>, _>("appearance").ok().flatten(),
                "habitable": r.try_get::<Option<i64>, _>("habitable").ok().flatten(),
                "distance": r.try_get::<Option<f64>, _>("distance").ok().flatten(),
                "longitude": r.try_get::<Option<f64>, _>("longitude").ok().flatten(),
                "latitude": r.try_get::<Option<f64>, _>("latitude").ok().flatten(),
                "subtype": r.try_get::<Option<String>, _>("subtype").ok().flatten(),
                "affColor": r.try_get::<Option<String>, _>("affColor").ok().flatten(),
```

- [ ] **Step 2: Étendre le type TS**

Dans `src/components/StarmapCanvas.tsx`, dans `export type StarmapBodyItem`, après `wikiUuid: string | null;` :

```ts
  appearance: string | null;
  habitable: number | null;
  distance: number | null;
  longitude: number | null;
  latitude: number | null;
  subtype: string | null;
  affColor: string | null;
```

- [ ] **Step 3: Vérifier compilation Rust + front**

Run: `cd src-tauri && cargo check --bins`
Expected: `Finished` sans erreur.

Run: `cd .. && npm run build`
Expected: build TypeScript + vite sans erreur.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/datamining.rs src/components/StarmapCanvas.tsx
git commit -m "feat(starmap): expose RSI fields (appearance/habitable/orbital) to front"
```

---

## Task 2: Vitest + module de placement (`placement.ts`)

**Files:**
- Modify: `package.json` (devDep + script `test`)
- Create: `vitest.config.ts`
- Modify: `tsconfig.json` (exclure `*.test.ts` du build)
- Create: `src/components/starmap3d/placement.ts`
- Create: `src/components/starmap3d/placement.test.ts`

**Interfaces:**
- Produces:
  - `SYS_R, R_MIN, PLANET_VR: number` (constantes)
  - `type Vec3 = [number, number, number]`
  - `orbitRadius(d: number, maxD: number): number`
  - `placeOnPlane(R: number, lonDeg: number): Vec3`
  - `bodyVisualRadius(size: number, maxSize: number): number`

- [ ] **Step 1: Installer Vitest**

Run: `npm install -D vitest@^2`
Expected: ajout de `vitest` aux devDependencies.

- [ ] **Step 2: Config Vitest + script + exclusion build**

Créer `vitest.config.ts` :

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
```

Ajouter à `package.json` `scripts` : `"test": "vitest run"`.

Dans `tsconfig.json`, ajouter `"**/*.test.ts"` au tableau `exclude` (créer la clé si absente, à côté de `include`) — pour que `tsc` du build de prod ignore les tests.

- [ ] **Step 3: Écrire les tests (échouent)**

`src/components/starmap3d/placement.test.ts` :

```ts
import { describe, it, expect } from "vitest";
import { orbitRadius, placeOnPlane, bodyVisualRadius, SYS_R, R_MIN } from "./placement";

describe("orbitRadius", () => {
  it("borne basse à R_MIN quand d=0", () => {
    expect(orbitRadius(0, 10)).toBeCloseTo(R_MIN);
  });
  it("atteint SYS_R quand d=maxD", () => {
    expect(orbitRadius(10, 10)).toBeCloseTo(SYS_R);
  });
  it("croissante (compression sqrt)", () => {
    expect(orbitRadius(2, 10)).toBeLessThan(orbitRadius(8, 10));
  });
  it("maxD<=0 → R_MIN", () => {
    expect(orbitRadius(5, 0)).toBe(R_MIN);
  });
});

describe("placeOnPlane", () => {
  it("lon=0 → sur l'axe X, y≈0 z≈0", () => {
    const [x, y, z] = placeOnPlane(100, 0);
    expect(x).toBeCloseTo(100);
    expect(y).toBeCloseTo(0);
    expect(z).toBeCloseTo(0);
  });
  it("lon=90 → x≈0, plan tilté (y<0)", () => {
    const [x, y, z] = placeOnPlane(100, 90);
    expect(x).toBeCloseTo(0);
    expect(y).toBeLessThan(0); // -z·sin(TILT)
    expect(z).toBeGreaterThan(0);
  });
});

describe("bodyVisualRadius", () => {
  it("max quand size=maxSize", () => {
    expect(bodyVisualRadius(10, 10)).toBeCloseTo(4.2);
  });
  it("croissante", () => {
    expect(bodyVisualRadius(1, 10)).toBeLessThan(bodyVisualRadius(9, 10));
  });
});
```

- [ ] **Step 4: Run tests → fail**

Run: `npx vitest run src/components/starmap3d/placement.test.ts`
Expected: FAIL (module `./placement` introuvable).

- [ ] **Step 5: Implémenter `placement.ts`**

```ts
// Placement orbital 3D — maths pures (aucune dépendance THREE/r3f), mirroir Stelliverse.
export const SYS_R = 360;
export const R_MIN = 26;
export const TILT_DEG = 20;
export const PLANET_VR = 4.2;
const TILT = (TILT_DEG * Math.PI) / 180;

export type Vec3 = [number, number, number];

/** Rayon orbital comprimé en sqrt : R_MIN (d=0) → SYS_R (d=maxD). */
export function orbitRadius(d: number, maxD: number): number {
  if (maxD <= 0) return R_MIN;
  return R_MIN + (SYS_R - R_MIN) * Math.sqrt(Math.max(0, d) / maxD);
}

/** Position dans le plan écliptique (XZ incliné de TILT autour de X). */
export function placeOnPlane(R: number, lonDeg: number): Vec3 {
  const a = (lonDeg * Math.PI) / 180;
  const x = R * Math.cos(a);
  const z = R * Math.sin(a);
  return [x, -z * Math.sin(TILT), z * Math.cos(TILT)];
}

/** Rayon visuel d'un disque de corps, comprimé en sqrt de sa taille. */
export function bodyVisualRadius(size: number, maxSize: number): number {
  if (maxSize <= 0) return 1.5;
  return 1.5 + (PLANET_VR - 1.5) * Math.sqrt(Math.max(0, size) / maxSize);
}
```

- [ ] **Step 6: Run tests → pass**

Run: `npx vitest run src/components/starmap3d/placement.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vitest.config.ts tsconfig.json src/components/starmap3d/placement.ts src/components/starmap3d/placement.test.ts
git commit -m "feat(starmap3d): vitest + module de placement orbital (maths pures)"
```

---

## Task 3: Textures procédurales (`textures.ts`)

**Files:**
- Create: `src/components/starmap3d/textures.ts`
- Create: `src/components/starmap3d/textures.test.ts`

**Interfaces:**
- Consumes: `three` (THREE.CanvasTexture).
- Produces:
  - `type TextureKind = "green" | "gas" | "brown" | "blue" | "rock"`
  - `textureKindFor(appearance: string | null | undefined): TextureKind`
  - `bodyTexture(kind: TextureKind): THREE.CanvasTexture` (cache module, lazy)
  - `starGlowTexture(): THREE.CanvasTexture`

- [ ] **Step 1: Écrire le test (échoue)**

`src/components/starmap3d/textures.test.ts` :

```ts
import { describe, it, expect } from "vitest";
import { textureKindFor } from "./textures";

describe("textureKindFor", () => {
  it("mappe les appearances connues", () => {
    expect(textureKindFor("PLANET_GREEN")).toBe("green");
    expect(textureKindFor("PLANET_GAS")).toBe("gas");
    expect(textureKindFor("PLANET_BROWN")).toBe("brown");
    expect(textureKindFor("PLANET_BLUE")).toBe("blue");
  });
  it("DEFAULT / null / inconnu → rock", () => {
    expect(textureKindFor("DEFAULT")).toBe("rock");
    expect(textureKindFor(null)).toBe("rock");
    expect(textureKindFor("PLANET_WTF")).toBe("rock");
  });
});
```

- [ ] **Step 2: Run → fail**

Run: `npx vitest run src/components/starmap3d/textures.test.ts`
Expected: FAIL (module introuvable).

- [ ] **Step 3: Implémenter `textures.ts`**

```ts
import * as THREE from "three";

export type TextureKind = "green" | "gas" | "brown" | "blue" | "rock";

export function textureKindFor(appearance: string | null | undefined): TextureKind {
  switch (appearance) {
    case "PLANET_GREEN": return "green";
    case "PLANET_GAS": return "gas";
    case "PLANET_BROWN": return "brown";
    case "PLANET_BLUE": return "blue";
    default: return "rock";
  }
}

const cache = new Map<TextureKind, THREE.CanvasTexture>();

function canvas(size = 512): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  return [c, c.getContext("2d")!];
}
function finish(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function blobs(x: CanvasRenderingContext2D, S: number, n: number, palette: string[], rMin: number, rMax: number, aMin: number, aMax: number) {
  for (let i = 0; i < n; i++) {
    const r = rMin + Math.pow(Math.random(), 2) * (rMax - rMin);
    x.globalAlpha = aMin + Math.random() * (aMax - aMin);
    x.fillStyle = palette[(Math.random() * palette.length) | 0];
    x.beginPath();
    x.arc(Math.random() * S, Math.random() * S, r, 0, 7);
    x.fill();
  }
  x.globalAlpha = 1;
}

function genGreen(S: number, x: CanvasRenderingContext2D) {
  x.fillStyle = "#1b4f7a"; x.fillRect(0, 0, S, S); // océan
  blobs(x, S, 40, ["#3f7d4f", "#5a9a5e", "#6f8f4a", "#37663f"], 18, 70, 0.6, 0.95); // continents
  blobs(x, S, 120, ["#dfeaf0", "#c8d8e0"], 6, 22, 0.05, 0.18); // nuages
}
function genGas(S: number, x: CanvasRenderingContext2D) {
  const bands = ["#b58a64", "#c8a074", "#9c7a58", "#d8b488", "#8a6a4c"];
  for (let i = 0; i < 22; i++) {
    x.fillStyle = bands[i % bands.length];
    const h = S / 22;
    x.globalAlpha = 0.85;
    x.fillRect(0, i * h, S, h + 1);
  }
  x.globalAlpha = 1;
  // tempête ovale
  const g = x.createRadialGradient(S * 0.62, S * 0.55, 4, S * 0.62, S * 0.55, S * 0.12);
  g.addColorStop(0, "#d98b5e"); g.addColorStop(1, "rgba(217,139,94,0)");
  x.fillStyle = g; x.beginPath(); x.ellipse(S * 0.62, S * 0.55, S * 0.13, S * 0.08, 0, 0, 7); x.fill();
}
function genBrown(S: number, x: CanvasRenderingContext2D) {
  x.fillStyle = "#7c5a3c"; x.fillRect(0, 0, S, S);
  blobs(x, S, 220, ["#5a3f29", "#8a6a47", "#3f2c1d", "#9c7a52", "#6b4a30"], 6, 40, 0.1, 0.3);
}
function genBlue(S: number, x: CanvasRenderingContext2D) {
  const g = x.createLinearGradient(0, 0, 0, S);
  g.addColorStop(0, "#bfe2ef"); g.addColorStop(0.5, "#5a93c4"); g.addColorStop(1, "#2f5e86");
  x.fillStyle = g; x.fillRect(0, 0, S, S);
  blobs(x, S, 60, ["#e6f4fb", "#9fc8e0"], 8, 30, 0.08, 0.22); // glace/nuages
}
function genRock(S: number, x: CanvasRenderingContext2D) {
  x.fillStyle = "#6a6056"; x.fillRect(0, 0, S, S);
  blobs(x, S, 300, ["#7c7163", "#544b41", "#857a6b", "#3f382f", "#928679"], 4, 26, 0.06, 0.2);
  for (let j = 0; j < 90; j++) { // cratères
    const pr = 3 + Math.pow(Math.random(), 1.5) * 16, px = Math.random() * S, py = Math.random() * S;
    const rg = x.createRadialGradient(px, py, 0, px, py, pr);
    rg.addColorStop(0, "rgba(8,6,6,.55)"); rg.addColorStop(1, "rgba(8,6,6,0)");
    x.fillStyle = rg; x.beginPath(); x.arc(px, py, pr, 0, 7); x.fill();
  }
}

const GENERATORS: Record<TextureKind, (S: number, x: CanvasRenderingContext2D) => void> = {
  green: genGreen, gas: genGas, brown: genBrown, blue: genBlue, rock: genRock,
};

export function bodyTexture(kind: TextureKind): THREE.CanvasTexture {
  const hit = cache.get(kind);
  if (hit) return hit;
  const S = 512;
  const [c, x] = canvas(S);
  GENERATORS[kind](S, x);
  const t = finish(c);
  cache.set(kind, t);
  return t;
}

let starGlow: THREE.CanvasTexture | null = null;
export function starGlowTexture(): THREE.CanvasTexture {
  if (starGlow) return starGlow;
  const [c, x] = canvas(128);
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.18, "rgba(255,244,221,.9)");
  g.addColorStop(0.45, "rgba(255,200,120,.28)");
  g.addColorStop(1, "rgba(255,180,90,0)");
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  starGlow = finish(c);
  return starGlow;
}
```

- [ ] **Step 4: Run → pass**

Run: `npx vitest run src/components/starmap3d/textures.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/starmap3d/textures.ts src/components/starmap3d/textures.test.ts
git commit -m "feat(starmap3d): textures procédurales par type + sélection testée"
```

---

## Task 4: Primitives r3f (`primitives.tsx`)

**Files:**
- Create: `src/components/starmap3d/primitives.tsx`

**Interfaces:**
- Consumes: `placement.ts` (Vec3), `textures.ts` (bodyTexture, starGlowTexture, textureKindFor), `three`, `@react-three/fiber` (useFrame, useThree), `@react-three/drei` (Html).
- Produces (composants) :
  - `Planet({ position, radius, appearance, habitable, isMoon, onClick, onOver, onOut, selected })`
  - `StarSphere({ position, radius, color })`
  - `OrbitRing({ points })` (points: Float32Array d'un anneau tilté pré-calculé)
  - `AsteroidBelt({ radius })`
  - `IconSprite({ position, kind, frac, onClick })` (taille-écran constante via useFrame)
  - `BodyLabel({ position, text, alwaysOn })`
  - util `screenScale(d, frac, fov): number`

- [ ] **Step 1: Implémenter `primitives.tsx`**

```tsx
import { useMemo, useRef } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import type { Vec3 } from "./placement";
import { bodyTexture, starGlowTexture, textureKindFor } from "./textures";

/** Taille MONDE pour qu'un sprite occupe ~`frac` de la hauteur écran à distance `d`. */
export function screenScale(d: number, frac: number, fov: number): number {
  return frac * 2 * d * Math.tan((fov * Math.PI) / 360);
}

export function StarSphere({ position, radius, color = "#fff4dd" }: { position: Vec3; radius: number; color?: string }) {
  const glow = useMemo(() => starGlowTexture(), []);
  return (
    <group position={position}>
      <mesh>
        <sphereGeometry args={[radius, 48, 32]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <sprite scale={[radius * 9, radius * 9, 1]}>
        <spriteMaterial map={glow} transparent depthWrite={false} blending={THREE.AdditiveBlending} opacity={0.9} />
      </sprite>
      <pointLight intensity={2.2} distance={SYS_LIGHT} decay={0} />
    </group>
  );
}
const SYS_LIGHT = 4000;

export function Planet({
  position, radius, appearance, habitable, isMoon, selected, onClick, onOver, onOut,
}: {
  position: Vec3; radius: number; appearance: string | null; habitable: number | null; isMoon: boolean;
  selected: boolean; onClick: (e: ThreeEvent<MouseEvent>) => void; onOver: () => void; onOut: () => void;
}) {
  const tex = useMemo(() => bodyTexture(textureKindFor(appearance)), [appearance]);
  return (
    <group position={position}>
      <mesh
        onClick={onClick}
        onPointerOver={(e) => { e.stopPropagation(); onOver(); }}
        onPointerOut={onOut}
      >
        <sphereGeometry args={[radius, isMoon ? 24 : 40, isMoon ? 16 : 28]} />
        <meshStandardMaterial map={tex} roughness={1} metalness={0} emissive={selected ? "#1a3a4a" : "#000"} />
      </mesh>
      {habitable === 1 && !isMoon && (
        <mesh scale={[radius * 1.06, radius * 1.06, radius * 1.06]}>
          <sphereGeometry args={[1, 24, 16]} />
          <meshBasicMaterial color="#54e6ff" transparent opacity={0.06} side={THREE.BackSide} />
        </mesh>
      )}
    </group>
  );
}

export function OrbitRing({ points }: { points: Float32Array }) {
  return (
    <line>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[points, 3]} />
      </bufferGeometry>
      <lineBasicMaterial color="#84b0e0" transparent opacity={0.16} />
    </line>
  );
}

export function AsteroidBelt({ radius, tilt }: { radius: number; tilt: number }) {
  const pts = useMemo(() => {
    const n = 500, arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, rr = radius + (Math.random() - 0.5) * 10;
      const x = rr * Math.cos(a), z = rr * Math.sin(a);
      arr[i * 3] = x;
      arr[i * 3 + 1] = -z * Math.sin(tilt) + (Math.random() - 0.5) * 2;
      arr[i * 3 + 2] = z * Math.cos(tilt);
    }
    return arr;
  }, [radius, tilt]);
  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[pts, 3]} />
      </bufferGeometry>
      <pointsMaterial color="#93a7c0" size={1.6} sizeAttenuation={false} transparent opacity={0.5} />
    </points>
  );
}

/** Sprite icône (canvas) à taille-écran constante. `kind`: 'station' | 'jump'. */
export function IconSprite({
  position, kind, frac, onClick,
}: { position: Vec3; kind: "station" | "jump"; frac: number; onClick?: (e: ThreeEvent<MouseEvent>) => void }) {
  const ref = useRef<THREE.Sprite>(null);
  const tex = useMemo(() => iconTexture(kind), [kind]);
  const { camera, size } = useThree();
  useFrame(() => {
    const s = ref.current;
    if (!s) return;
    const d = camera.position.distanceTo(s.position);
    const fov = (camera as THREE.PerspectiveCamera).fov ?? 50;
    const sc = screenScale(d, frac, fov);
    s.scale.set(sc, sc, 1);
  });
  void size;
  return (
    <sprite ref={ref} position={position} onClick={onClick}>
      <spriteMaterial map={tex} transparent depthTest />
    </sprite>
  );
}

const iconCache = new Map<string, THREE.CanvasTexture>();
function iconTexture(kind: "station" | "jump"): THREE.CanvasTexture {
  const hit = iconCache.get(kind);
  if (hit) return hit;
  const S = 64, c = document.createElement("canvas"); c.width = c.height = S;
  const x = c.getContext("2d")!;
  const jump = kind === "jump";
  // puce arrondie sombre + liseré
  x.beginPath();
  const r = 14, a = 4, b = 4, w = S - 8, h = S - 8;
  x.moveTo(a + r, b); x.arcTo(a + w, b, a + w, b + h, r); x.arcTo(a + w, b + h, a, b + h, r);
  x.arcTo(a, b + h, a, b, r); x.arcTo(a, b, a + w, b, r); x.closePath();
  x.fillStyle = "rgba(6,11,20,.92)"; x.fill();
  x.lineWidth = 2.5; x.strokeStyle = jump ? "rgba(255,196,108,.95)" : "rgba(125,222,255,.9)"; x.stroke();
  x.save(); x.translate(32, 32);
  x.strokeStyle = jump ? "#ffd9a0" : "#f1f7ff"; x.fillStyle = x.strokeStyle;
  x.lineWidth = 3; x.lineJoin = "round"; x.lineCap = "round";
  if (jump) {
    for (const rad of [13, 7]) {
      x.lineWidth = rad === 13 ? 3 : 2;
      x.beginPath();
      for (let i = 0; i <= 6; i++) { const an = (Math.PI / 3) * i - Math.PI / 2; const fn = i ? "lineTo" : "moveTo"; x[fn](Math.cos(an) * rad, Math.sin(an) * rad); }
      x.closePath(); x.stroke();
    }
    x.beginPath(); x.arc(0, 0, 2, 0, 7); x.fill();
  } else {
    x.beginPath(); x.ellipse(0, 0, 14, 8, 0, 0, 7); x.stroke();
    x.beginPath(); x.arc(0, 0, 4.5, 0, 7); x.fill();
  }
  x.restore();
  const t = new THREE.CanvasTexture(c); t.minFilter = THREE.LinearFilter;
  iconCache.set(kind, t);
  return t;
}

export function BodyLabel({ position, text }: { position: Vec3; text: string }) {
  return (
    <Html position={position} center distanceFactor={60} style={{ pointerEvents: "none" }}>
      <div className="whitespace-nowrap rounded bg-black/70 px-1.5 py-0.5 text-[11px] text-white/90">{text}</div>
    </Html>
  );
}
```

- [ ] **Step 2: Vérifier compilation**

Run: `npm run build`
Expected: build sans erreur TypeScript.

- [ ] **Step 3: Commit**

```bash
git add src/components/starmap3d/primitives.tsx
git commit -m "feat(starmap3d): primitives r3f (planète texturée, glow, halo, ceinture, icônes)"
```

---

## Task 5: Scène + navigation (`Starmap3D.tsx`) et bascule

**Files:**
- Create: `src/components/starmap3d/Starmap3D.tsx`
- Modify: `src/components/Starmap3D.tsx` (remplacé par un ré-export)

**Interfaces:**
- Consumes: `placement.ts`, `primitives.tsx`, `StarmapCanvas` (`buildSystemLayout` n'est PAS utilisé ; on prend `GALAXY_POSITIONS, GALAXY_LINKS, SYSTEM_COLORS, SYSTEM_NAMES, safeName, type StarmapBodyItem`).
- Produces: `export default function Starmap3D({ bodies, system })`.

- [ ] **Step 1: Construire le layout système depuis les champs RSI**

Créer `src/components/starmap3d/Starmap3D.tsx`. Layout système : on place directement depuis `longitude`/`distance` (repli schématique si absents).

```tsx
import { useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Stars } from "@react-three/drei";
import {
  GALAXY_POSITIONS, GALAXY_LINKS, SYSTEM_COLORS, SYSTEM_NAMES, safeName,
  type StarmapBodyItem,
} from "../StarmapCanvas";
import { orbitRadius, placeOnPlane, bodyVisualRadius, TILT_DEG, type Vec3 } from "./placement";
import { Planet, StarSphere, OrbitRing, AsteroidBelt, IconSprite, BodyLabel } from "./primitives";

const TILT = (TILT_DEG * Math.PI) / 180;
const GAL_SCALE = 0.18;

type Placed = {
  body: StarmapBodyItem; pos: Vec3; radius: number; kind: "star" | "planet" | "moon" | "station" | "jump" | "belt";
  ringR?: number;
};

function key(b: StarmapBodyItem): string {
  return (b.wikiUuid ?? b.recordName.split(".").pop() ?? "").toLowerCase();
}
function parentKey(b: StarmapBodyItem): string {
  return (b.parentRef ?? "").toLowerCase();
}

/** Place tous les corps d'un système directement depuis les champs orbitaux RSI. */
function layoutSystem(bodies: StarmapBodyItem[], systemId: string): Placed[] {
  const list = bodies.filter((b) => b.systemName === systemId && !b.hideInStarmap);
  const star = list.find((b) => b.navIcon === "Star") ?? null;
  const out: Placed[] = [];
  if (star) out.push({ body: star, pos: [0, 0, 0], radius: 7, kind: "star" });

  const planets = list.filter((b) => b.navIcon === "Planet");
  const maxD = Math.max(1, ...planets.map((p) => p.distance ?? 0));
  const maxSize = Math.max(1, ...planets.map((p) => p.size ?? 0));
  const angleFallback = (i: number, n: number) => (n ? (i / n) * 360 : 0);

  planets.forEach((p, i) => {
    const R = orbitRadius(p.distance ?? (i + 1) / planets.length * maxD, maxD);
    const lon = p.longitude ?? angleFallback(i, planets.length);
    const pos = placeOnPlane(R, lon);
    const radius = bodyVisualRadius(p.size ?? 0, maxSize);
    out.push({ body: p, pos, radius, kind: "planet", ringR: R });

    // enfants : lunes + stations
    const kids = list.filter((c) => parentKey(c) === key(p));
    const moons = kids.filter((c) => c.navIcon === "Moon");
    const stations = kids.filter((c) => c.navIcon === "Station");
    moons.forEach((m, j) => {
      const rr = radius * (moons.length === 1 ? 3 : 2.4 + (2.6 * j) / Math.max(1, moons.length - 1));
      const mlon = m.longitude ?? j * 70;
      const local = placeOnPlane(rr, mlon);
      out.push({
        body: m, pos: [pos[0] + local[0], pos[1] + local[1], pos[2] + local[2]],
        radius: Math.max(0.7, radius * 0.34), kind: "moon", ringR: rr,
      });
    });
    stations.forEach((s, j) => {
      const rr = radius * (stations.length === 1 ? 1.9 : 1.7 + (0.9 * j) / Math.max(1, stations.length - 1));
      const local = placeOnPlane(rr, s.longitude ?? j * 55 + 20);
      out.push({ body: s, pos: [pos[0] + local[0], pos[1] + local[1], pos[2] + local[2]], radius: 0, kind: "station" });
    });
  });

  // ceintures + jump-points au niveau étoile
  list.filter((b) => b.navIcon === "AsteroidBelt").forEach((belt, i) => {
    const R = orbitRadius(belt.distance ?? maxD * 0.6, maxD);
    out.push({ body: belt, pos: [0, 0, 0], radius: 0, kind: "belt", ringR: R });
    void i;
  });
  list.filter((b) => b.navIcon === "Jumppoint").forEach((jp, i) => {
    const R = orbitRadius(jp.distance ?? maxD, maxD);
    out.push({ body: jp, pos: placeOnPlane(R, jp.longitude ?? i * 50), radius: 0, kind: "jump" });
  });
  return out;
}

function ringPoints(R: number, center: Vec3 = [0, 0, 0]): Float32Array {
  const seg = 128, arr: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2, x = R * Math.cos(a), z = R * Math.sin(a);
    arr.push(center[0] + x, center[1] - z * Math.sin(TILT), center[2] + z * Math.cos(TILT));
  }
  return new Float32Array(arr);
}
```

- [ ] **Step 2: Construire la scène + navigation galaxie/système/objet**

Ajouter, dans le même fichier, les vues et le composant (réutilise le HUD/breadcrumb de l'ancien renderer) :

```tsx
type View = { level: "galaxy" } | { level: "system"; systemId: string } | { level: "object"; systemId: string; bodyId: string };

function galaxyData(bodies: StarmapBodyItem[]) {
  const systems = [...new Set(bodies.map((b) => b.systemName))];
  const nodes = systems.map((s) => {
    const k = s.toLowerCase();
    const gp = GALAXY_POSITIONS[k] ?? { gx: 0, gy: 0 };
    return { id: s, name: SYSTEM_NAMES[k] ?? s.toUpperCase(), color: SYSTEM_COLORS[k] ?? "#f5a623", pos: [gp.gx * GAL_SCALE, 0, gp.gy * GAL_SCALE] as Vec3 };
  });
  const posOf = (id: string) => nodes.find((n) => n.id.toLowerCase() === id.toLowerCase())?.pos ?? null;
  const links = GALAXY_LINKS.map(([a, b]) => [posOf(a), posOf(b)]).filter((l): l is [Vec3, Vec3] => l[0] != null && l[1] != null);
  return { nodes, links };
}

export default function Starmap3D({ bodies, system }: { bodies: StarmapBodyItem[]; system: string }) {
  const [view, setView] = useState<View>({ level: "system", systemId: system });
  const [selected, setSelected] = useState<StarmapBodyItem | null>(null);

  const galaxy = useMemo(() => galaxyData(bodies), [bodies]);
  const placed = useMemo(
    () => (view.level !== "galaxy" ? layoutSystem(bodies, view.systemId) : []),
    [bodies, view],
  );

  const focusable = useMemo(() => {
    const s = new Set<string>();
    for (const p of placed) {
      const hasKids = placed.some((c) => parentKey(c.body) === key(p.body));
      if ((p.kind === "planet" || p.kind === "moon") && hasKids) s.add(p.body.id);
    }
    return s;
  }, [placed]);

  const shown = useMemo(() => {
    if (view.level !== "object") return placed;
    const focus = placed.find((p) => p.body.id === view.bodyId);
    if (!focus) return placed;
    const kids = placed.filter((p) => parentKey(p.body) === key(focus.body));
    return [{ ...focus, pos: [0, 0, 0] as Vec3 }, ...kids.map((kch) => ({
      ...kch, pos: [kch.pos[0] - focus.pos[0], kch.pos[1] - focus.pos[1], kch.pos[2] - focus.pos[2]] as Vec3,
    }))];
  }, [placed, view]);

  const camPos: Vec3 = view.level === "galaxy" ? [0, 220, 300] : view.level === "object" ? [0, 14, 22] : [0, 240, 360];
  const camKey = view.level === "galaxy" ? "galaxy" : view.level === "object" ? `obj:${view.bodyId}` : `sys:${view.systemId}`;
  const currentSystemId = view.level === "galaxy" ? null : view.systemId;
  const crumb = view.level === "galaxy" ? "GALAXIE"
    : view.level === "object" ? (placed.find((p) => p.body.id === view.bodyId)?.body.name.toUpperCase() ?? "")
    : SYSTEM_NAMES[view.systemId.toLowerCase()] ?? view.systemId.toUpperCase();

  function onBodyClick(b: StarmapBodyItem) {
    setSelected(b);
    if (view.level === "system" && focusable.has(b.id)) setView({ level: "object", systemId: view.systemId, bodyId: b.id });
  }

  const navBtn = "cursor-pointer rounded px-2 py-0.5 text-[11px] font-semibold tracking-wider text-white/60 transition-colors hover:text-[var(--accent)]";

  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl border border-white/10 bg-black">
      <div className="absolute left-3 top-3 z-10 flex items-center gap-1.5">
        <span className={navBtn} onClick={() => setView({ level: "galaxy" })}>GLX</span>
        {currentSystemId && <span className={navBtn} onClick={() => setView({ level: "system", systemId: currentSystemId })}>SYS</span>}
        <span className="ml-2 text-[12px] font-bold uppercase tracking-[0.18em]" style={{ color: "var(--accent)" }}>{crumb}</span>
      </div>

      <Canvas key={camKey} camera={{ position: camPos, fov: 50, far: 8000 }} onPointerMissed={() => setSelected(null)}>
        <ambientLight intensity={0.34} />
        <Stars radius={2000} depth={400} count={3000} factor={6} fade speed={0.3} />

        {view.level === "galaxy" && galaxy.nodes.map((s) => (
          <group key={s.id} position={s.pos} onClick={(e) => { e.stopPropagation(); setView({ level: "system", systemId: s.id }); }}>
            <mesh><sphereGeometry args={[5, 24, 24]} /><meshBasicMaterial color={s.color} /></mesh>
            <pointLight intensity={1.2} distance={120} decay={0} color={s.color} />
            <BodyLabel position={[0, 8, 0]} text={s.name} />
          </group>
        ))}

        {view.level !== "galaxy" && shown.map((p) => {
          if (p.kind === "star") return <StarSphere key={p.body.id} position={p.pos} radius={p.radius} />;
          if (p.kind === "belt") return <AsteroidBelt key={p.body.id} radius={p.ringR ?? 100} tilt={TILT} />;
          if (p.kind === "jump") return <IconSprite key={p.body.id} position={p.pos} kind="jump" frac={0.045} onClick={(e) => { e.stopPropagation(); setSelected(p.body); }} />;
          if (p.kind === "station") return <IconSprite key={p.body.id} position={p.pos} kind="station" frac={0.03} onClick={(e) => { e.stopPropagation(); setSelected(p.body); }} />;
          return (
            <group key={p.body.id}>
              {p.kind === "planet" && p.ringR != null && <OrbitRing points={ringPoints(p.ringR)} />}
              <Planet
                position={p.pos} radius={p.radius} appearance={p.body.appearance} habitable={p.body.habitable}
                isMoon={p.kind === "moon"} selected={selected?.id === p.body.id}
                onClick={(e) => { e.stopPropagation(); onBodyClick(p.body); }}
                onOver={() => undefined} onOut={() => undefined}
              />
              <BodyLabel position={[p.pos[0], p.pos[1] + p.radius + 4, p.pos[2]]} text={safeName(p.body)} />
            </group>
          );
        })}

        <OrbitControls enablePan enableDamping dampingFactor={0.1} minDistance={3} maxDistance={2000} />
      </Canvas>

      {selected && (
        <div className="absolute left-3 bottom-3 max-w-xs rounded-xl border border-white/15 bg-[#0a0a0f]/85 p-3 backdrop-blur">
          <div className="text-sm font-semibold text-white">{safeName(selected)}</div>
          <div className="mt-1 text-[11px] uppercase tracking-wider text-white/40">
            {selected.navIcon}{selected.subtype ? ` · ${selected.subtype}` : ""} · {selected.systemName}
          </div>
          {selected.habitable === 1 && <div className="mt-1 text-[11px] text-cyan-300">Habitable</div>}
          {selected.description && <p className="mt-2 line-clamp-4 text-xs text-white/60">{selected.description}</p>}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Remplacer l'ancien `Starmap3D.tsx` par un ré-export**

Remplacer tout le contenu de `src/components/Starmap3D.tsx` par :

```tsx
export { default } from "./starmap3d/Starmap3D";
```

- [ ] **Step 4: Vérifier build + tests complets**

Run: `npm run build`
Expected: build sans erreur.

Run: `npm test`
Expected: tous les tests Vitest PASS (placement + textures).

Run: `cd src-tauri && cargo test --bins`
Expected: 16 tests PASS (aucune régression backend).

- [ ] **Step 5: Commit**

```bash
git add src/components/starmap3d/Starmap3D.tsx src/components/Starmap3D.tsx
git commit -m "feat(starmap3d): nouvelle scène 3D (placement orbital RSI, textures, LOD, nav)"
```

---

## Notes d'exécution

- Ordre 1→5. Chaque tâche compile/teste avant commit.
- Le rendu visuel final se valide **au runtime** (lancer l'app, vue 3D) — non couvert par les tests automatisés (qui valident le placement et la sélection de texture).
- Repli placement déjà intégré dans `layoutSystem` (fallbacks `?? angleFallback` / `?? maxD`).
- Sous-projet C éventuel (POI de surface VerseTime) : non couvert ici.
