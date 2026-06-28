import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Stars } from "@react-three/drei";
import {
  GALAXY_POSITIONS,
  GALAXY_LINKS,
  SYSTEM_COLORS,
  SYSTEM_NAMES,
  safeName,
  type StarmapBodyItem,
} from "../StarmapCanvas";
import { orbitRadius, placeOnPlane, bodyVisualRadius, TILT_DEG, type Vec3 } from "./placement";
import { Planet, StarSphere, OrbitRing, AsteroidBelt, IconSprite, Station, BodyLabel } from "./primitives";

/* ──────────────────────────────────────────────────────────────────────────
 * Carte 3D (sous-projet B) — placement orbital direct depuis les champs RSI
 * (longitude/distance), textures procédurales par type, glow/halo/ceintures/
 * jump-points, sprites à taille-écran constante. Découplé de la 2D.
 * ────────────────────────────────────────────────────────────────────────── */

const TILT = (TILT_DEG * Math.PI) / 180;
const GAL_SCALE = 0.18;

type Kind = "star" | "planet" | "moon" | "station" | "jump" | "belt";
type Placed = { body: StarmapBodyItem; pos: Vec3; radius: number; kind: Kind; ringR?: number };

function bodyJoinKey(b: StarmapBodyItem): string {
  return (b.wikiUuid ?? b.recordName.split(".").pop() ?? "").toLowerCase();
}
function parentJoinKey(b: StarmapBodyItem): string {
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
    const R = orbitRadius(p.distance ?? ((i + 1) / planets.length) * maxD, maxD);
    const lon = p.longitude ?? angleFallback(i, planets.length);
    const pos = placeOnPlane(R, lon);
    const radius = bodyVisualRadius(p.size ?? 0, maxSize);
    out.push({ body: p, pos, radius, kind: "planet", ringR: R });

    const kids = list.filter((c) => parentJoinKey(c) === bodyJoinKey(p));
    const moons = kids.filter((c) => c.navIcon === "Moon");
    const stations = kids.filter((c) => c.navIcon === "Station");
    moons.forEach((m, j) => {
      const rr = radius * (moons.length === 1 ? 3 : 2.4 + (2.6 * j) / Math.max(1, moons.length - 1));
      const local = placeOnPlane(rr, m.longitude ?? j * 70);
      out.push({
        body: m,
        pos: [pos[0] + local[0], pos[1] + local[1], pos[2] + local[2]],
        radius: Math.max(0.7, radius * 0.34),
        kind: "moon",
        ringR: rr,
      });
    });
    stations.forEach((s, j) => {
      const rr = radius * (stations.length === 1 ? 1.9 : 1.7 + (0.9 * j) / Math.max(1, stations.length - 1));
      const local = placeOnPlane(rr, s.longitude ?? j * 55 + 20);
      out.push({
        body: s,
        pos: [pos[0] + local[0], pos[1] + local[1], pos[2] + local[2]],
        radius: 0,
        kind: "station",
      });
    });
  });

  list
    .filter((b) => b.navIcon === "AsteroidBelt")
    .forEach((belt) => {
      const R = orbitRadius(belt.distance ?? maxD * 0.6, maxD);
      out.push({ body: belt, pos: [0, 0, 0], radius: 0, kind: "belt", ringR: R });
    });
  list
    .filter((b) => b.navIcon === "Jumppoint")
    .forEach((jp, i) => {
      const R = orbitRadius(jp.distance ?? maxD, maxD);
      out.push({ body: jp, pos: placeOnPlane(R, jp.longitude ?? i * 50), radius: 0, kind: "jump" });
    });
  return out;
}

/** Anneau (128 segments) dans le plan écliptique tilté, centré à `center`. */
function ringPoints(R: number, center: Vec3 = [0, 0, 0]): Float32Array {
  const seg = 128;
  const arr: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const x = R * Math.cos(a);
    const z = R * Math.sin(a);
    arr.push(center[0] + x, center[1] - z * Math.sin(TILT), center[2] + z * Math.cos(TILT));
  }
  return new Float32Array(arr);
}

type View =
  | { level: "galaxy" }
  | { level: "system"; systemId: string }
  | { level: "object"; systemId: string; bodyId: string };

function galaxyData(bodies: StarmapBodyItem[]) {
  const systems = [...new Set(bodies.map((b) => b.systemName))];
  const nodes = systems.map((s) => {
    const k = s.toLowerCase();
    const gp = GALAXY_POSITIONS[k] ?? { gx: 0, gy: 0 };
    return {
      id: s,
      name: SYSTEM_NAMES[k] ?? s.toUpperCase(),
      color: SYSTEM_COLORS[k] ?? "#f5a623",
      pos: [gp.gx * GAL_SCALE, 0, gp.gy * GAL_SCALE] as Vec3,
    };
  });
  const posOf = (id: string) => nodes.find((n) => n.id.toLowerCase() === id.toLowerCase())?.pos ?? null;
  const links = GALAXY_LINKS.map(([a, b]) => [posOf(a), posOf(b)]).filter(
    (l): l is [Vec3, Vec3] => l[0] != null && l[1] != null,
  );
  return { nodes, links };
}

export default function Starmap3D({ bodies, system }: { bodies: StarmapBodyItem[]; system: string }) {
  const { t } = useTranslation();
  const [view, setView] = useState<View>({ level: "system", systemId: system });
  const [selected, setSelected] = useState<StarmapBodyItem | null>(null);
  const [query, setQuery] = useState("");

  // Recherche : index de tous les corps nommés (tous systèmes) → navigation auto.
  const searchIndex = useMemo(
    () =>
      bodies.filter(
        (b) => !b.hideInStarmap && ["Star", "Planet", "Moon", "Station", "Jumppoint"].includes(b.navIcon),
      ),
    [bodies],
  );
  const results = useMemo(() => {
    const nq = query.trim().toLowerCase();
    if (nq.length < 2) return [];
    return searchIndex.filter((b) => safeName(b).toLowerCase().includes(nq)).slice(0, 8);
  }, [query, searchIndex]);
  function goToResult(b: StarmapBodyItem) {
    if (b.navIcon === "Planet" || b.navIcon === "Moon") {
      setView({ level: "object", systemId: b.systemName, bodyId: b.id });
    } else {
      setView({ level: "system", systemId: b.systemName });
    }
    setSelected(b);
    setQuery("");
  }

  // Le sélecteur de système (StarmapPage) change la prop `system` : on bascule la vue
  // sur ce système (sinon le select restait sans effet — la vue n'était lue qu'au montage).
  useEffect(() => {
    setView((v) => (v.level !== "galaxy" && v.systemId === system ? v : { level: "system", systemId: system }));
    setSelected(null);
  }, [system]);

  const galaxy = useMemo(() => galaxyData(bodies), [bodies]);
  const placed = useMemo(
    () => (view.level !== "galaxy" ? layoutSystem(bodies, view.systemId) : []),
    [bodies, view],
  );

  const focusable = useMemo(() => {
    const s = new Set<string>();
    for (const p of placed) {
      const hasKids = placed.some((c) => parentJoinKey(c.body) === bodyJoinKey(p.body));
      if ((p.kind === "planet" || p.kind === "moon") && hasKids) s.add(p.body.id);
    }
    return s;
  }, [placed]);

  // Vue objet : focus à l'origine, enfants en relatif.
  const shown = useMemo(() => {
    if (view.level !== "object") return placed;
    const focus = placed.find((p) => p.body.id === view.bodyId);
    if (!focus) return placed;
    const kids = placed.filter((p) => parentJoinKey(p.body) === bodyJoinKey(focus.body));
    return [
      { ...focus, pos: [0, 0, 0] as Vec3 },
      ...kids.map((kch) => ({
        ...kch,
        pos: [kch.pos[0] - focus.pos[0], kch.pos[1] - focus.pos[1], kch.pos[2] - focus.pos[2]] as Vec3,
      })),
    ];
  }, [placed, view]);

  // Anneaux : héliocentriques (planètes) en vue système ; planétocentriques (lunes,
  // focus à l'origine) en vue objet.
  const rings = useMemo(() => {
    if (view.level === "system")
      return shown.filter((p) => p.kind === "planet" && p.ringR != null).map((p) => ringPoints(p.ringR!));
    if (view.level === "object")
      return shown.filter((p) => p.kind === "moon" && p.ringR != null).map((p) => ringPoints(p.ringR!));
    return [];
  }, [shown, view.level]);

  const camPos: Vec3 =
    view.level === "galaxy" ? [0, 220, 300] : view.level === "object" ? [0, 14, 22] : [0, 240, 360];
  const camKey =
    view.level === "galaxy" ? "galaxy" : view.level === "object" ? `obj:${view.bodyId}` : `sys:${view.systemId}`;
  const currentSystemId = view.level === "galaxy" ? null : view.systemId;
  const crumb =
    view.level === "galaxy"
      ? "GALAXIE"
      : view.level === "object"
        ? placed.find((p) => p.body.id === view.bodyId)?.body.name.toUpperCase() ?? ""
        : SYSTEM_NAMES[view.systemId.toLowerCase()] ?? view.systemId.toUpperCase();

  function onBodyClick(b: StarmapBodyItem) {
    setSelected(b);
    if (view.level === "system" && focusable.has(b.id))
      setView({ level: "object", systemId: view.systemId, bodyId: b.id });
  }

  const navBtn =
    "cursor-pointer rounded px-2 py-0.5 text-[11px] font-semibold tracking-wider text-white/60 transition-colors hover:text-[var(--accent)]";

  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl border border-white/10 bg-black">
      <div className="absolute left-3 top-3 z-10 flex items-center gap-1.5">
        <span className={navBtn} onClick={() => setView({ level: "galaxy" })}>
          GLX
        </span>
        {currentSystemId && (
          <span className={navBtn} onClick={() => setView({ level: "system", systemId: currentSystemId })}>
            SYS
          </span>
        )}
        <span className="ml-2 text-[12px] font-bold uppercase tracking-[0.18em]" style={{ color: "var(--accent)" }}>
          {crumb}
        </span>
      </div>

      {/* Recherche : tape un lieu → vol auto vers lui (corps / station / point de saut). */}
      <div className="absolute right-3 top-3 z-10 w-56">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("starmap.search")}
          className="w-full rounded-lg border border-white/10 bg-black/60 px-3 py-1.5 text-sm text-white placeholder:text-white/40 focus:border-[var(--accent)] focus:outline-none"
        />
        {results.length > 0 && (
          <div className="mt-1 overflow-hidden rounded-lg border border-white/10 bg-[#0a0a0f]/95 backdrop-blur">
            {results.map((b) => (
              <button
                key={b.id}
                onClick={() => goToResult(b)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-white/80 transition-colors hover:bg-white/10"
              >
                <span className="flex-1 truncate">{safeName(b)}</span>
                <span className="shrink-0 font-mono text-[9px] uppercase text-white/40">{b.systemName}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <Canvas key={camKey} camera={{ position: camPos, fov: 50, far: 8000 }} onPointerMissed={() => setSelected(null)}>
        <ambientLight intensity={0.34} />
        <Stars radius={2000} depth={400} count={3000} factor={6} fade speed={0.3} />

        {view.level === "galaxy" && (
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
                  setView({ level: "system", systemId: s.id });
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
        )}

        {view.level !== "galaxy" && (
          <>
            {rings.map((pts, i) => (
              <OrbitRing key={`ring${i}`} points={pts} />
            ))}
            {shown.map((p) => {
              if (p.kind === "star") return <StarSphere key={p.body.id} position={p.pos} radius={p.radius} />;
              if (p.kind === "belt")
                return <AsteroidBelt key={p.body.id} radius={p.ringR ?? 100} tilt={TILT} />;
              if (p.kind === "jump")
                return (
                  <IconSprite
                    key={p.body.id}
                    position={p.pos}
                    kind="jump"
                    frac={0.045}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelected(p.body);
                    }}
                  />
                );
              if (p.kind === "station")
                return (
                  <Station
                    key={p.body.id}
                    position={p.pos}
                    frac={0.03}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelected(p.body);
                    }}
                  />
                );
              return (
                <group key={p.body.id}>
                  <Planet
                    position={p.pos}
                    radius={p.radius}
                    appearance={p.body.appearance}
                    habitable={p.body.habitable}
                    isMoon={p.kind === "moon"}
                    selected={selected?.id === p.body.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      onBodyClick(p.body);
                    }}
                    onOver={() => undefined}
                    onOut={() => undefined}
                  />
                  <BodyLabel position={[p.pos[0], p.pos[1] + p.radius + 4, p.pos[2]]} text={safeName(p.body)} />
                </group>
              );
            })}
          </>
        )}

        <OrbitControls enablePan enableDamping dampingFactor={0.1} minDistance={3} maxDistance={2000} />
      </Canvas>

      {selected && (
        <div className="absolute left-3 bottom-3 max-w-xs rounded-xl border border-white/15 bg-[#0a0a0f]/85 p-3 backdrop-blur">
          <div className="text-sm font-semibold text-white">{safeName(selected)}</div>
          <div className="mt-1 text-[11px] uppercase tracking-wider text-white/40">
            {selected.navIcon}
            {selected.subtype ? ` · ${selected.subtype}` : ""} · {selected.systemName}
          </div>
          {selected.habitable === 1 && <div className="mt-1 text-[11px] text-cyan-300">Habitable</div>}
          {selected.description && <p className="mt-2 line-clamp-4 text-xs text-white/60">{selected.description}</p>}
        </div>
      )}
    </div>
  );
}
