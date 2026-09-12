// Étape 1 — valeur « au scan » : valeur brute théorique du cargo (avant raffinage),
// répartie par minéral, avec badge live/repli sur le prix utilisé.

import { fmtAUEC } from "../../../lib/format";
import { mineralByKey } from "../../../lib/miningRegistry";
import { priceOf, cleanOre } from "../helpers";
import type { OreLine, SellPoint } from "../types";

export function ScanValue({
  ore,
  sells,
  t,
}: {
  ore: OreLine[];
  sells: Record<string, SellPoint>;
  t: (k: string, o?: Record<string, unknown>) => string;
}) {
  const lines = cleanOre(ore);
  const total = lines.reduce((s, o) => s + o.scu * priceOf(o.key, sells), 0);

  return (
    <div>
      <div className="mb-3 flex items-baseline gap-2">
        <b className="text-[24px] font-bold tabular-nums text-white">{fmtAUEC(Math.round(total))}</b>
        <span className="text-[12px] text-white/45">{t("mining.scanRawHint")}</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {lines.length === 0 && <p className="text-[13px] text-white/40">{t("mining.scanEmpty")}</p>}
        {lines
          .map((o) => ({ o, val: o.scu * priceOf(o.key, sells), live: !!sells[o.key] }))
          .sort((a, b) => b.val - a.val)
          .map(({ o, val, live }) => (
            <div key={o.key} className="flex items-center justify-between gap-2 text-[13px]">
              <span className="flex items-center gap-2 text-white/80">
                {mineralByKey[o.key]?.name ?? o.key}
                <span className="text-white/35">· {o.scu} SCU</span>
                {!live && (
                  <span className="rounded bg-[var(--amber)]/15 px-1.5 py-0.5 text-[10px] font-medium text-[var(--amber)]">
                    {t("mining.offline")}
                  </span>
                )}
              </span>
              <span className="tabular-nums text-white/90">{fmtAUEC(Math.round(val))}</span>
            </div>
          ))}
      </div>
    </div>
  );
}
