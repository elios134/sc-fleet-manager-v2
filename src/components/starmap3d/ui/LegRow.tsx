import { useTranslation } from "react-i18next";
import { appLocale } from "../../../lib/format";
import type { FuelState, Leg } from "../itinerary";

export const gmFmt = (n: number | null) => (n == null ? "—" : `${n.toLocaleString(appLocale(), { maximumFractionDigits: 1 })} Gm`);

const FUEL_CHIP: Record<Exclude<FuelState, null>, string> = {
  ok: "border-emerald-400/35 bg-emerald-400/15 text-emerald-300",
  refuel: "border-[var(--amber)]/40 bg-[var(--amber-muted)] text-amber-300",
  tooFar: "border-red-400/40 bg-red-400/15 text-red-300",
};
const chip = "rounded-full border px-2 font-sans text-[10px] font-bold";

function FuelChip({ state }: { state: FuelState }) {
  const { t } = useTranslation();
  return state ? <span className={`${chip} ${FUEL_CHIP[state]}`}>{t(`starmap.itinerary.fuel.${state}`)}</span> : null;
}

/** Distance entre deux étapes ; un saut entre systèmes s'affiche en deux moitiés (ravitaillement
 *  possible à la Gateway), une distance estimée (carte RSI) porte « ≈ » et un badge. */
export function LegRow({ leg, fuel }: { leg: Leg; fuel: { leg: FuelState; parts: [FuelState, FuelState] | null } }) {
  const { t } = useTranslation();
  const approx = (gm: number | null) => (leg.estimated && gm != null ? `≈ ${gmFmt(gm)}` : gmFmt(gm));
  const estimate = leg.estimated && <span className={`${chip} border-white/15 bg-white/[0.06] text-white/55`}>{t("starmap.itinerary.estimate")}</span>;
  const line = "flex flex-wrap items-center gap-2";
  return (
    <div className="ml-5 flex flex-col gap-1 border-l-2 border-dashed border-[var(--accent)]/45 py-1.5 pl-4 font-mono text-[11.5px] text-white/60">
      {leg.jump && leg.parts ? (
        <>
          <p className={line}>
            {t("starmap.itinerary.toJump", { gm: gmFmt(leg.parts[0]) })}
            <FuelChip state={fuel.parts?.[0] ?? null} />
          </p>
          <p className={line}>
            <span className={`${chip} border-[var(--rival)]/35 bg-[var(--rival)]/15 text-orange-300`}>{t("starmap.itinerary.via", { jump: leg.jump })}</span>
            <span className={`${chip} ${FUEL_CHIP.ok}`}>{t("starmap.itinerary.refuelGateway")}</span>
          </p>
          <p className={line}>
            {t("starmap.itinerary.fromJump", { gm: approx(leg.parts[1]) })}
            <FuelChip state={fuel.parts?.[1] ?? null} />
            {estimate}
          </p>
        </>
      ) : (
        <p className={line}>
          {approx(leg.gm)}
          <FuelChip state={fuel.leg} />
          {estimate}
        </p>
      )}
    </div>
  );
}
