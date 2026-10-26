// Bilan du work order (fiche fixe à droite) : valeur brute, raffinage, vente, profit net.

import { fmtAUEC } from "../../../lib/format";
import { fmtDur } from "../helpers";
import type { MethodResult } from "../types";

function Row({ label, value, strong }: { label: string; value: string; strong?: "accent" | "white" }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-white/[0.06] py-2 text-[13px] last:border-0">
      <span className={strong ? "text-white/80" : "text-white/50"}>{label}</span>
      <b className={`tabular-nums ${strong === "accent" ? "text-[16px] text-emerald-300" : "text-white"}`}>{value}</b>
    </div>
  );
}

export function WorkOrderSummary({
  chosen,
  rawScu,
  scan,
  t,
}: {
  chosen: MethodResult | null;
  rawScu: number;
  scan: number;
  t: (k: string, o?: Record<string, unknown>) => string;
}) {
  const aUEC = (n: number) => fmtAUEC(Math.round(n));
  return (
    <div>
      <h2 className="mb-2 text-sm font-bold text-white">{t("mining.summaryTitle")}</h2>
      <Row label={t("mining.sumRaw")} value={`${rawScu.toLocaleString("fr-FR")} SCU`} />
      <Row label={t("mining.sumScan")} value={rawScu > 0 ? aUEC(scan) : "—"} />
      <Row
        label={chosen ? t("mining.sumRefine", { method: chosen.name, time: fmtDur(chosen.durationSecs) }) : t("mining.sumRefineNone")}
        value={chosen ? `−${aUEC(chosen.cost)}` : "—"}
      />
      <Row label={t("mining.sumSell")} value={chosen ? aUEC(chosen.revenue) : "—"} />
      <Row label={t("mining.sumNet")} value={chosen ? aUEC(chosen.net) : "—"} strong="accent" />
      <Row label={t("mining.sumPerHour")} value={chosen ? `${aUEC(chosen.netPerHour)}/h` : "—"} />
    </div>
  );
}
