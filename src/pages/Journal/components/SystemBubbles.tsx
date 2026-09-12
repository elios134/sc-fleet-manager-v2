// Bulles des systèmes visités : aire ∝ heures (rayon en sqrt). Palette catégorielle
// validée CVD (Stanton/Pyro/Nyx et suivants).

import type { NamedSeconds } from "../types";
import { fmtHours } from "../helpers";

const PALETTE = ["#6366f1", "#c47c1a", "#12a594", "#b05fd6", "#4f9dde"];

export function SystemBubbles({ systems, empty }: { systems: NamedSeconds[]; empty: string }) {
  if (systems.length === 0) {
    return <p className="py-10 text-center text-xs text-white/40">{empty}</p>;
  }
  const max = Math.max(...systems.map((s) => s.seconds), 1);
  return (
    <div className="flex h-[190px] items-center justify-around gap-2 pt-1.5">
      {systems.slice(0, 5).map((s, i) => {
        const size = Math.round(38 + Math.sqrt(s.seconds / max) * 76); // 38–114 px
        const color = PALETTE[i % PALETTE.length];
        const fs = Math.max(11, Math.round(size * 0.22));
        return (
          <div key={s.name} className="flex flex-col items-center gap-2">
            <div
              className="grid place-items-center rounded-full font-semibold text-black"
              style={{
                width: size,
                height: size,
                fontSize: fs,
                border: "1px solid rgba(255,255,255,0.18)",
                background: `radial-gradient(circle at 38% 32%, ${color}, color-mix(in oklab, ${color} 80%, black))`,
              }}
            >
              {Math.round(s.seconds / 3600)}
            </div>
            <span className="text-[12px] font-semibold" style={{ color }}>
              {s.name}
            </span>
            <span className="text-[11px] text-white/50">{fmtHours(s.seconds)}</span>
          </div>
        );
      })}
    </div>
  );
}
