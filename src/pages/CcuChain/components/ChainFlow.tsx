import { useTranslation } from "react-i18next";
import { type CcuShip, type CcuPath, type WarbondTag } from "../types";
import { fmtMoney, fmtMoneyDelta, shipName } from "../helpers";

// Flux horizontal illustré (boîtes DÉPART / ÉTAPE n / CIBLE + liens +$delta). Pas de
// vignette top-down dans les boîtes (fidélité V1 — seuls les panneaux 3a en ont).
function ChainFlow({
  path,
  shipsById,
}: {
  path: CcuPath;
  shipsById: Map<number, CcuShip>;
}) {
  const { t } = useTranslation();
  if (path.steps.length === 0) return null;
  const startId = path.steps[0]!.fromShipId;

  const node = (
    shipId: number,
    kind: "start" | "step" | "target",
    stepIdx: number,
    owned: boolean,
    warbondTag: WarbondTag,
  ) => {
    const meta = shipsById.get(shipId);
    const borderColor =
      kind === "target" ? "var(--accent)" : owned ? "rgb(52 211 153 / 0.7)" : "rgba(255,255,255,0.1)";
    const manufacturer = meta?.manufacturer ?? "—";
    const label =
      kind === "start"
        ? t('ccu.flowStart', { manufacturer })
        : kind === "target"
          ? t('ccu.flowTarget', { manufacturer })
          : t('ccu.flowStep', { step: stepIdx, manufacturer });
    return (
      <div
        className="relative shrink-0 rounded-lg bg-black/20 p-3"
        style={{ minWidth: 160, border: `1px solid ${borderColor}` }}
      >
        <div className="absolute -top-2 right-1.5 flex flex-col items-end gap-1">
          {kind === "target" && (
            <span className="rounded-sm bg-[var(--accent)] px-1.5 py-px text-[8px] font-bold uppercase tracking-wider text-black">
              {t('ccu.tagTarget')}
            </span>
          )}
          {kind === "step" && owned && (
            <span className="rounded-sm bg-emerald-400 px-1.5 py-px text-[8px] font-bold uppercase tracking-wider text-black">
              {t('ccu.tagOwned')}
            </span>
          )}
          {warbondTag === "warbond" && (
            <span className="rounded-sm border border-[var(--accent)] px-1.5 py-px text-[8px] font-bold uppercase tracking-wider text-[var(--accent)]">
              {t('ccu.tagWarbond')}
            </span>
          )}
          {warbondTag === "standard" && (
            <span className="rounded-sm border border-white/30 px-1.5 py-px text-[8px] font-bold uppercase tracking-wider text-white/40">
              {t('ccu.tagStandard')}
            </span>
          )}
        </div>
        <div className="text-[9px] uppercase tracking-wider text-white/40">{label}</div>
        <div className="mt-1 text-[13px] font-semibold text-white">{shipName(shipsById, shipId)}</div>
        {meta && (
          <div className="mt-1 text-[11px] text-white/40">
            {t('ccu.value')}{" "}
            <span className="font-semibold text-[var(--accent)]">
              {meta.priceCents != null ? (
                <>
                  {fmtMoney(meta.priceCents)}
                  {meta.priceSource === "msrp" && (
                    <span className="ml-1 font-normal text-white/40">MSRP</span>
                  )}
                  {meta.isWarbondPrice && (
                    <span className="ml-1 font-normal uppercase tracking-wider text-amber-400">
                      {t('ccu.warbond')}
                    </span>
                  )}
                </>
              ) : (
                "—"
              )}
            </span>
          </div>
        )}
      </div>
    );
  };

  const link = (cents: number) => (
    <div className="flex shrink-0 flex-col items-center justify-center px-3" style={{ minWidth: 84 }}>
      <div className="text-lg leading-none text-[var(--accent)]">→</div>
      <div className="mt-1 text-[13px] font-bold text-[var(--accent)]">{fmtMoneyDelta(cents)}</div>
    </div>
  );

  return (
    <div className="flex items-stretch overflow-x-auto py-2">
      {node(startId, "start", 0, path.steps[0]!.isOwnedSourceShip, "none")}
      {path.steps.map((step, i) => {
        const isLast = i === path.steps.length - 1;
        const warbondTag: WarbondTag =
          path.warbondEndIndex === null ? "none" : i <= path.warbondEndIndex ? "warbond" : "standard";
        const nextOwned = isLast ? false : path.steps[i + 1]!.isOwnedSourceShip;
        return (
          <div key={step.toSkuId} className="flex items-stretch">
            {link(step.upgradePriceCents)}
            {node(step.toShipId, isLast ? "target" : "step", i + 1, nextOwned, warbondTag)}
          </div>
        );
      })}
    </div>
  );
}

export { ChainFlow };
