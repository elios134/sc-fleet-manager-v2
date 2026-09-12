// Bandeau résumé du work order : profit net, temps, rendement horaire de la méthode choisie.

import { Coins, Timer, TrendingUp, Boxes } from "lucide-react";
import { fmtAUEC } from "../../../lib/format";
import { fmtDur } from "../helpers";
import type { MethodResult } from "../types";

function Tile({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex-1 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
      <div className="mb-1 flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-white/40">
        {icon} {label}
      </div>
      <div className={`text-[20px] font-bold tabular-nums ${accent ? "text-[var(--accent)]" : "text-white"}`}>{value}</div>
    </div>
  );
}

export function WorkOrderSummary({
  chosen,
  rawScu,
  t,
}: {
  chosen: MethodResult | null;
  rawScu: number;
  t: (k: string, o?: Record<string, unknown>) => string;
}) {
  return (
    <div className="flex flex-wrap gap-3">
      <Tile icon={<Boxes className="h-3.5 w-3.5" />} label={t("mining.sumRaw")} value={`${rawScu.toLocaleString("fr-FR")} SCU`} />
      <Tile
        icon={<Coins className="h-3.5 w-3.5" />}
        label={t("mining.sumNet")}
        value={chosen ? fmtAUEC(Math.round(chosen.net)) : "—"}
        accent
      />
      <Tile icon={<Timer className="h-3.5 w-3.5" />} label={t("mining.sumTime")} value={chosen ? fmtDur(chosen.durationSecs) : "—"} />
      <Tile
        icon={<TrendingUp className="h-3.5 w-3.5" />}
        label={t("mining.sumPerHour")}
        value={chosen ? `${fmtAUEC(Math.round(chosen.netPerHour))}/h` : "—"}
      />
    </div>
  );
}
