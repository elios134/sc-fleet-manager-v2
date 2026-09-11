import { Repeat, Box, Navigation, Search } from "lucide-react";
import { type TFunction } from "i18next";

function ToolRail({ tab, setTab, t }: { tab: string; setTab: (v: "single" | "loop" | "gps" | "grid") => void; t: TFunction }) {
  const steps = [
    { k: "single", n: "01", short: t("cargo.railFind"), Icon: Search },
    { k: "loop", n: "02", short: t("cargo.railLoop"), Icon: Repeat },
    { k: "gps", n: "03", short: t("cargo.railGps"), Icon: Navigation },
    { k: "grid", n: "04", short: t("cargo.railGrid"), Icon: Box },
  ] as const;
  return (
    <nav className="flex shrink-0 flex-row gap-1 overflow-x-auto rounded-2xl border border-white/10 bg-black/20 p-2 lg:w-[84px] lg:flex-col lg:items-center lg:overflow-visible">
      {steps.map((s, i) => {
        const on = tab === s.k;
        return (
          <div key={s.k} className="flex flex-col items-center lg:w-full">
            <button
              type="button"
              onClick={() => setTab(s.k)}
              className={`relative flex w-full flex-col items-center gap-1.5 rounded-xl px-2 py-2.5 text-[9px] font-semibold uppercase tracking-[0.08em] transition-colors ${
                on ? "text-white" : "text-white/40 hover:text-white/70"
              }`}
            >
              <span className="absolute right-2 top-1.5 text-[8px] tabular-nums text-white/25">{s.n}</span>
              <span
                className={`grid h-9 w-9 place-items-center rounded-xl border transition-colors ${
                  on
                    ? "border-[var(--accent)]/50 bg-[var(--accent)]/[0.18] text-[var(--accent2,#8b5cf6)]"
                    : "border-transparent"
                }`}
                style={on ? { boxShadow: "0 0 20px -4px var(--accent)" } : undefined}
              >
                <s.Icon className="h-[18px] w-[18px]" />
              </span>
              {s.short}
            </button>
            {i < steps.length - 1 && <span className="hidden h-3 w-0.5 bg-gradient-to-b from-white/10 to-transparent lg:block" />}
          </div>
        );
      })}
    </nav>
  );
}

// ── Convoi actif : barre basse persistante, relie les outils ──

export { ToolRail };
