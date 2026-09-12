import { useState } from "react";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { type CcuShip, type CcuPath } from "../types";
import { fmtMoney, fmtMoneyDelta, fmtPct, shipName } from "../helpers";
import { ChainFlow } from "./ChainFlow";

function PathCard({
  path,
  rank,
  isBest,
  expanded,
  onToggle,
  shipsById,
}: {
  path: CcuPath;
  rank: number;
  isBest: boolean;
  expanded: boolean;
  onToggle: () => void;
  shipsById: Map<number, CcuShip>;
}) {
  const { t } = useTranslation();
  const startId = path.steps[0]?.fromShipId;
  const positiveSaving = path.savingCents != null && path.savingCents > 0;
  const [copied, setCopied] = useState(false);

  function openRsi() {
    void openUrl("https://robertsspaceindustries.com/en/account/pledges");
  }

  function copyPlan() {
    const start = startId !== undefined ? shipName(shipsById, startId) : "?";
    const hops = path.steps
      .map((s) => `${shipName(shipsById, s.toShipId)} (${fmtMoneyDelta(s.upgradePriceCents)})`)
      .join(" → ");
    const text = `${start} → ${hops} | TOTAL: ${fmtMoney(path.totalCostCents)}`;
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div
      className="relative overflow-hidden rounded-2xl bg-white/5"
      style={{ border: `1px solid ${expanded || isBest ? "var(--accent)" : "rgba(255,255,255,0.1)"}` }}
    >
      {isBest && (
        <span className="absolute left-0 top-0 z-10 rounded-br-lg bg-[var(--accent)] px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-black">
          {t('ccu.best')}
        </span>
      )}

      <button
        type="button"
        onClick={onToggle}
        className="grid w-full items-center gap-4 px-4 py-3.5 text-left"
        style={{ gridTemplateColumns: "auto 1fr auto auto auto" }}
      >
        <span
          className="w-7 text-lg font-bold"
          style={{ color: isBest ? "var(--accent)" : "rgba(255,255,255,0.4)", paddingLeft: isBest ? 6 : 0 }}
        >
          #{rank}
        </span>

        <span className="flex min-w-0 flex-wrap items-center gap-2">
          {startId !== undefined && (
            <span
              className="text-xs font-medium"
              style={{ color: path.steps[0]!.isOwnedSourceShip ? "rgb(52 211 153)" : "white" }}
            >
              {shipName(shipsById, startId)}
            </span>
          )}
          {path.steps.map((step, i) => {
            const inStandard = path.warbondEndIndex !== null && i > path.warbondEndIndex;
            return (
              <span key={step.toSkuId} className="flex items-center gap-2">
                <span className="text-[10px] text-white/40">
                  <span className="font-semibold text-[var(--accent)]">
                    {fmtMoneyDelta(step.upgradePriceCents)}
                  </span>{" "}
                  →
                </span>
                <span
                  className="text-xs font-medium"
                  style={{
                    color: inStandard ? "rgba(255,255,255,0.4)" : "white",
                    fontStyle: inStandard ? "italic" : "normal",
                  }}
                >
                  {shipName(shipsById, step.toShipId)}
                </span>
              </span>
            );
          })}
        </span>

        <span className="text-right">
          <div className="text-[9px] uppercase tracking-[0.2em] text-white/40">{t('ccu.total')}</div>
          <div className="text-base font-bold text-[var(--accent)]">{fmtMoney(path.totalCostCents)}</div>
        </span>

        <span className="text-right" style={{ minWidth: 64 }}>
          <div className="text-[9px] uppercase tracking-[0.2em] text-white/40">{t('ccu.saving')}</div>
          {positiveSaving ? (
            <div className="text-sm font-semibold text-emerald-400">
              -{fmtMoney(path.savingCents!)}
              <span className="ml-1 text-[10px] text-white/40">
                {fmtPct(-path.savingCents!, path.directCostCents)}
              </span>
            </div>
          ) : (
            <div className="text-xs text-white/40">{t('ccu.reference')}</div>
          )}
        </span>

        <span
          className="text-sm transition-transform"
          style={{
            color: expanded ? "var(--accent)" : "rgba(255,255,255,0.4)",
            transform: expanded ? "rotate(180deg)" : "none",
          }}
        >
          ▾
        </span>
      </button>

      {expanded && (
        <div className="border-t border-white/10 bg-black/20 px-5 py-4">
          <ChainFlow path={path} shipsById={shipsById} />
          <div className="mt-4 flex gap-2.5 border-t border-white/10 pt-4">
            <button
              type="button"
              onClick={openRsi}
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-black transition-opacity hover:opacity-90"
            >
              {t('ccu.openOnRsi')}
            </button>
            <button
              type="button"
              onClick={copyPlan}
              className="rounded-lg border border-white/10 px-4 py-2 text-[11px] uppercase tracking-wider text-white/70 transition-colors hover:bg-white/5"
            >
              {copied ? t('ccu.copied') : t('ccu.copyPlan')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export { PathCard };
