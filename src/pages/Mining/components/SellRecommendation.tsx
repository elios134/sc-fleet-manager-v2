// Étape 3 — où vendre le raffiné : une carte par minéral (meilleur terminal, revenu,
// prix/SCU, demande, fraîcheur), calculée sur les quantités raffinées de la méthode choisie.

import { Store } from "lucide-react";
import { fmtAUEC } from "../../../lib/format";
import { mineralByKey, methodByKey } from "../../../lib/miningRegistry";
import { priceOf, cleanOre, freshness } from "../helpers";
import type { OreLine, SellPoint } from "../types";

export function SellRecommendation({
  ore,
  sells,
  methodKey,
  t,
}: {
  ore: OreLine[];
  sells: Record<string, SellPoint>;
  methodKey: string | null;
  t: (k: string, o?: Record<string, unknown>) => string;
}) {
  const yieldMult = methodKey ? methodByKey[methodKey]?.yieldMult ?? 1 : 1;
  const lines = cleanOre(ore)
    .map((o) => {
      const refined = o.scu * yieldMult;
      const sp = sells[o.key];
      const price = priceOf(o.key, sells);
      return { key: o.key, refined, sp, price, revenue: refined * price };
    })
    .sort((a, b) => b.revenue - a.revenue);

  if (lines.length === 0) return <p className="text-[13px] text-white/40">{t("mining.scanEmpty")}</p>;

  return (
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
      {lines.map(({ key, refined, sp, price, revenue }) => (
        <div key={key} className="rounded-xl border border-white/10 bg-white/[0.02] px-3.5 py-3">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[13px] font-bold text-white/90">{mineralByKey[key]?.name ?? key}</span>
            <span className="text-[14px] font-extrabold tabular-nums text-white">{fmtAUEC(Math.round(revenue))}</span>
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-white/50">
            <Store className="h-3 w-3 shrink-0" />
            {sp ? (
              <span className="truncate">
                {sp.terminal}
                {sp.system && <span className="text-white/30"> · {sp.system}</span>}
              </span>
            ) : (
              <span className="text-[var(--amber)]">{t("mining.noLivePrice")}</span>
            )}
          </div>
          <div className="mt-1 flex justify-between text-[10.5px] text-white/40">
            <span className="tabular-nums">
              {refined.toFixed(1)} SCU · {fmtAUEC(Math.round(price))}/SCU
            </span>
            {sp && <span>{freshness(sp.updatedAt)}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
