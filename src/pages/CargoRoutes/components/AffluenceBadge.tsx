import { type TFunction } from "i18next";
import { type Affluence } from "../types";

function AffluenceBadge({ level, t }: { level: Affluence; t: TFunction }) {
  const map: Record<Affluence, { label: string; cls: string }> = {
    low: { label: t("cargo.gps.affLow"), cls: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300" },
    medium: { label: t("cargo.gps.affMedium"), cls: "border-amber-400/40 bg-amber-400/10 text-amber-300" },
    high: { label: t("cargo.gps.affHigh"), cls: "border-red-400/40 bg-red-400/10 text-red-300" },
  };
  const m = map[level];
  return (
    <span
      title={t("cargo.gps.affTitle")}
      className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${m.cls}`}
    >
      {t("cargo.gps.affEstimated")} · {m.label}
    </span>
  );
}

/* Badge carburant quantique d'un leg : coût en SCU. Passe au rouge + « ravitaillement » quand
   `over` (le leg dépasse le carburant restant sur le trajet cumulé). Le caller ne le rend que
   si l'autonomie du vaisseau est connue. */

export { AffluenceBadge };
