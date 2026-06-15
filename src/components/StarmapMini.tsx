import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Map as MapIcon } from "lucide-react";
import type { TFunction } from "i18next";

/* ──────────────────────────────────────────────────────────────────────────
 * Lot 4 — Mini-carte galactique (aperçu statique léger).
 *
 * APERÇU seulement : la vraie carte interactive reste StarmapPage (/starmap).
 * On n'importe PAS StarmapCanvas. Données via get_starmap_bodies, mais comme
 * posX/Y/Z sont NULL en base, le placement est SYNTHÉTISÉ (positions fixes des
 * 3 systèmes, façon maquette). On ne garde que Star + Planet ; le nombre de
 * planètes par système est réel (Stanton 4, Pyro 5, Nyx 3).
 * ────────────────────────────────────────────────────────────────────────── */

type Body = {
  systemName: string;
  navIcon: string;
  name: string;
  orbitOrder: number | null;
  size: number | null;
};

// Positions synthétiques fixes des 3 systèmes (posX/Y/Z NULL → pas de vraies
// coords, comme la maquette). cx/cy dans un viewBox 520×240.
const SYSTEMS = [
  { key: "stanton", fallback: "Stanton", color: "#f5a623", cx: 140, cy: 120, base: 8 },
  { key: "pyro", fallback: "Pyro", color: "#d4537e", cx: 340, cy: 90, base: 40 },
  { key: "nyx", fallback: "Nyx", color: "#5dcaa5", cx: 420, cy: 180, base: 70 },
] as const;

// Routes pointillées entre systèmes (déco, comme la maquette).
const ROUTES = [
  { from: 0, to: 1, color: "rgba(245,166,35,0.22)" },
  { from: 1, to: 2, color: "rgba(213,83,126,0.22)" },
];

const FIRST_RING = 16;
const RING_STEP = 7;
const GOLDEN = 137.50776; // angle d'or → planètes bien réparties sur leurs orbites

// Champ d'étoiles statique : PRNG seedé (stable entre rendus), cohérent DA V2.
function makeStars() {
  let s = 0x9e3779b9 >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: 55 }, () => ({
    x: +(rnd() * 520).toFixed(1),
    y: +(rnd() * 240).toFixed(1),
    r: +(0.3 + rnd() * 0.9).toFixed(1),
    o: +(0.15 + rnd() * 0.45).toFixed(2),
  }));
}
const STARS = makeStars();

export default function StarmapMini({ t }: { t: TFunction }) {
  const [bodies, setBodies] = useState<Body[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    invoke<Body[]>("get_starmap_bodies")
      .then((b) => {
        if (!cancelled) setBodies(Array.isArray(b) ? b : []);
      })
      .catch(() => {
        if (!cancelled) setBodies([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Planètes réelles par système (filtre Star + Planet ; ici on agrège Planet).
  const planetsBySystem = useMemo(() => {
    const map: Record<string, Body[]> = {};
    (bodies ?? []).forEach((b) => {
      if (b.navIcon !== "Planet") return;
      (map[b.systemName] ??= []).push(b);
    });
    Object.values(map).forEach((arr) =>
      arr.sort((a, b) => (a.orbitOrder ?? 99) - (b.orbitOrder ?? 99)),
    );
    return map;
  }, [bodies]);

  // Noms d'étoiles réels (données, tels quels) ; fallback si absent.
  const starNames = useMemo(() => {
    const map: Record<string, string> = {};
    (bodies ?? []).forEach((b) => {
      if (b.navIcon === "Star") map[b.systemName] = b.name;
    });
    return map;
  }, [bodies]);

  const hasData =
    bodies != null &&
    SYSTEMS.some((s) => (planetsBySystem[s.key]?.length ?? 0) > 0);

  // Chargement en cours : fond neutre, pas de message trompeur.
  if (bodies === null) {
    return (
      <div className="min-h-[180px] rounded-[10px] border border-white/[0.06] bg-[#0a0818]" />
    );
  }

  // Données absentes (starmap pas encore dataminée) : placeholder neutre.
  if (!hasData) {
    return (
      <div className="flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-[10px] border border-white/[0.06] bg-[#0a0818] text-center">
        <MapIcon className="h-5 w-5 text-white/25" />
        <span className="px-6 text-xs leading-relaxed text-white/35">
          {t("dashboard.wStarmapEmpty")}
        </span>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[10px] border border-white/[0.06]">
      <svg viewBox="0 0 520 240" width="100%" style={{ display: "block" }}>
        <rect width="520" height="240" fill="#0a0818" />

        {/* Fond étoilé léger */}
        {STARS.map((st, i) => (
          <circle key={`s${i}`} cx={st.x} cy={st.y} r={st.r} fill="#fff" opacity={st.o} />
        ))}

        {/* Routes pointillées entre systèmes */}
        {ROUTES.map((rt, i) => {
          const a = SYSTEMS[rt.from];
          const b = SYSTEMS[rt.to];
          return (
            <line
              key={`r${i}`}
              x1={a.cx}
              y1={a.cy}
              x2={b.cx}
              y2={b.cy}
              stroke={rt.color}
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          );
        })}

        {/* Systèmes : orbites concentriques (1 par planète) + étoile + nom */}
        {SYSTEMS.map((sys) => {
          const planets = planetsBySystem[sys.key] ?? [];
          const label = (starNames[sys.key] ?? sys.fallback).toUpperCase();
          return (
            <g key={sys.key}>
              {planets.map((_, i) => {
                const radius = FIRST_RING + i * RING_STEP;
                const ang = ((sys.base + i * GOLDEN) * Math.PI) / 180;
                const px = sys.cx + radius * Math.cos(ang);
                const py = sys.cy + radius * Math.sin(ang);
                return (
                  <g key={i}>
                    <circle
                      cx={sys.cx}
                      cy={sys.cy}
                      r={radius}
                      fill="none"
                      stroke="rgba(255,255,255,0.06)"
                      strokeWidth={0.5}
                    />
                    <circle cx={px} cy={py} r={2} fill="rgba(255,255,255,0.7)" />
                  </g>
                );
              })}

              {/* Lueur + cœur de l'étoile */}
              <circle
                cx={sys.cx}
                cy={sys.cy}
                r={11}
                fill="none"
                stroke={sys.color}
                strokeWidth={0.5}
                opacity={0.5}
              />
              <circle cx={sys.cx} cy={sys.cy} r={6} fill={sys.color} />

              {/* Nom du système */}
              <text
                x={sys.cx}
                y={sys.cy + 34}
                textAnchor="middle"
                fontSize={9}
                fontWeight={600}
                fill={sys.color}
                letterSpacing={1}
                style={{ fontFamily: "Inter, sans-serif" }}
              >
                {label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
