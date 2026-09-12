// Étape 2 — optimiseur de raffinage : les 9 méthodes en cartes comparables (profit ou
// rendement horaire), la meilleure/choisie mise en avant. Cliquer une carte la propage
// au résumé et à la vente.

import { methodByKey } from "../../../lib/miningRegistry";
import { fmtAUEC } from "../../../lib/format";
import { fmtDur } from "../helpers";
import type { MethodResult } from "../types";

const TIER_KEY: Record<string, string> = { low: "mining.tLow", moderate: "mining.tMod", high: "mining.tHigh" };
const SPEED_KEY: Record<string, string> = {
  veryLow: "mining.spVLow", low: "mining.spLow", moderate: "mining.spMod", high: "mining.spHigh", veryHigh: "mining.spVHigh",
};

function Pill({ text, tone }: { text: string; tone: "hi" | "lo" | "" }) {
  const cls =
    tone === "hi"
      ? "bg-[rgba(46,233,165,0.14)] text-[#5fe6b8]"
      : tone === "lo"
        ? "bg-[var(--amber-muted)] text-[var(--amber)]"
        : "bg-white/[0.06] text-white/50";
  return <span className={`rounded-md px-1.5 py-0.5 text-[10px] ${cls}`}>{text}</span>;
}

export function RefineOptimizer({
  results,
  chosenKey,
  onPick,
  by,
  onBy,
  t,
}: {
  results: MethodResult[];
  chosenKey: string | null;
  onPick: (key: string) => void;
  by: "net" | "netPerHour";
  onBy: (by: "net" | "netPerHour") => void;
  t: (k: string) => string;
}) {
  return (
    <div>
      <div className="mb-3.5 flex items-center justify-between gap-2">
        <span className="text-[12px] font-semibold uppercase tracking-[0.13em] text-white/50">{t("mining.refineTitle")}</span>
        <div className="inline-flex gap-0.5 rounded-lg border border-white/10 bg-white/5 p-0.5">
          {(["net", "netPerHour"] as const).map((k) => (
            <button
              key={k}
              onClick={() => onBy(k)}
              aria-pressed={by === k}
              className={[
                "rounded-md px-3 py-1 text-[12px] font-medium transition-colors",
                by === k ? "bg-[var(--accent-muted)] text-[var(--accent)]" : "text-white/50 hover:text-white/90",
              ].join(" ")}
            >
              {k === "net" ? t("mining.byNet") : t("mining.byHour")}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
        {results.map((r, i) => {
          const m = methodByKey[r.key];
          const active = r.key === chosenKey;
          const speedTone = m.speed === "high" || m.speed === "veryHigh" ? "hi" : m.speed === "veryLow" ? "lo" : "";
          const yieldTone = m.yieldTier === "high" ? "hi" : m.yieldTier === "low" ? "lo" : "";
          const costTone = m.costTier === "high" ? "lo" : "";
          return (
            <button
              key={r.key}
              onClick={() => onPick(r.key)}
              className={[
                "relative rounded-2xl border p-3.5 text-left transition-colors",
                active
                  ? "border-[var(--accent)] bg-[linear-gradient(180deg,rgba(99,102,241,0.14),rgba(99,102,241,0.03))]"
                  : "border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.045]",
              ].join(" ")}
            >
              <span className={`absolute right-3 top-3 text-[10.5px] ${i === 0 ? "font-bold text-[var(--accent)]" : "text-white/40"}`}>
                {i === 0 ? t("mining.best") : `#${i + 1}`}
              </span>
              <div className="pr-14 text-[13.5px] font-bold text-white">{r.name}</div>
              <div className={`mt-2 text-[21px] font-extrabold tabular-nums ${active ? "text-[var(--accent)]" : "text-white"}`}>
                {fmtAUEC(Math.round(r.net))}
              </div>
              <div className="text-[10.5px] uppercase tracking-wide text-white/40">{t("mining.colNet")}</div>

              <div className="mt-2.5 flex gap-2.5 border-t border-white/[0.07] pt-2.5 text-[11px]">
                <div className="flex-1">
                  <span className="block text-white/40">{t("mining.colRefined")}</span>
                  <span className="font-semibold tabular-nums text-white/85">{r.refinedScu.toFixed(1)}</span>
                </div>
                <div className="flex-1">
                  <span className="block text-white/40">{t("mining.colTime")}</span>
                  <span className="font-semibold tabular-nums text-white/85">{fmtDur(r.durationSecs)}</span>
                </div>
                <div className="flex-1">
                  <span className="block text-white/40">{t("mining.colPerHour")}</span>
                  <span className="font-semibold tabular-nums text-white/85">{fmtAUEC(Math.round(r.netPerHour))}</span>
                </div>
              </div>

              <div className="mt-2.5 flex flex-wrap gap-1.5">
                <Pill text={t(SPEED_KEY[m.speed])} tone={speedTone} />
                <Pill text={`${t("mining.yield")} ${t(TIER_KEY[m.yieldTier])}`} tone={yieldTone} />
                <Pill text={`${t("mining.cost")} ${t(TIER_KEY[m.costTier])}`} tone={costTone} />
              </div>
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-[10.5px] text-white/30">{t("mining.modelNote")}</p>
    </div>
  );
}
