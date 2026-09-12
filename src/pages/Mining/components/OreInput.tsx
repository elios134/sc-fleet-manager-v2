// Saisie du brut : une ou plusieurs lignes minéral + quantité SCU.

import { Plus, X } from "lucide-react";
import { MINERALS } from "../../../lib/miningRegistry";
import type { OreLine } from "../types";

const TIER_DOT: Record<string, string> = {
  exotic: "#c084fc",
  rare: "#f472b6",
  precious: "#f59e0b",
  industrial: "#60a5fa",
  common: "#9ca3af",
};

export function OreInput({
  ore,
  onChange,
  t,
}: {
  ore: OreLine[];
  onChange: (next: OreLine[]) => void;
  t: (k: string) => string;
}) {
  function setLine(i: number, patch: Partial<OreLine>) {
    onChange(ore.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  }
  function addLine() {
    const used = new Set(ore.map((o) => o.key));
    const next = MINERALS.find((m) => !used.has(m.key)) ?? MINERALS[0];
    onChange([...ore, { key: next.key, scu: 16 }]);
  }
  function removeLine(i: number) {
    onChange(ore.filter((_, j) => j !== i));
  }

  return (
    <div className="flex flex-col gap-2">
      {ore.map((line, i) => (
        <div key={i} className="flex items-center gap-2">
          <select
            value={line.key}
            onChange={(e) => setLine(i, { key: e.target.value })}
            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-[13px] text-white/90 outline-none focus:border-[var(--accent)]"
          >
            {MINERALS.map((m) => (
              <option key={m.key} value={m.key} className="bg-[#12121a]">
                {m.name}
              </option>
            ))}
          </select>
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ background: TIER_DOT[MINERALS.find((m) => m.key === line.key)?.tier ?? "common"] }}
          />
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min={0}
              value={line.scu}
              onChange={(e) => setLine(i, { scu: Math.max(0, Number(e.target.value) || 0) })}
              className="w-20 rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-right text-[13px] tabular-nums text-white/90 outline-none focus:border-[var(--accent)]"
            />
            <span className="text-[11px] text-white/40">SCU</span>
          </div>
          <button
            onClick={() => removeLine(i)}
            disabled={ore.length <= 1}
            className="rounded-lg p-1.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white/80 disabled:opacity-30"
            aria-label={t("mining.removeLine")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
      <button
        onClick={addLine}
        className="mt-1 inline-flex w-fit items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[12px] font-medium text-white/70 transition-colors hover:bg-white/10"
      >
        <Plus className="h-3.5 w-3.5" /> {t("mining.addLine")}
      </button>
    </div>
  );
}
