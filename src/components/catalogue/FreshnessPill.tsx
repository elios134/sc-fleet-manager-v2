import { type TFunction } from "i18next";
import { priceFreshness } from "../../lib/priceFreshness";

// Pastille d'âge d'un prix (vert = frais ≤ 2 j, ambre sinon). Rien si horodatage absent.
// `prefix` permet « maj il y a 3 h » (en-tête) vs juste « 3 h » (ligne compacte).
export function FreshnessPill({
  dateModified,
  t,
  prefix = false,
}: {
  dateModified: number | null | undefined;
  t: TFunction;
  prefix?: boolean;
}) {
  const age = priceFreshness(dateModified, t);
  if (!age) return null;
  const cls = age.fresh
    ? "bg-emerald-400/12 text-emerald-300"
    : "bg-amber-400/12 text-amber-200";
  const dot = age.fresh ? "bg-emerald-400" : "bg-amber-400";
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-px text-[10px] tabular-nums ${cls}`}>
      <span className={`h-1 w-1 rounded-full ${dot}`} />
      {prefix ? t("catalogue.priceAge", { age: age.label }) : age.label}
    </span>
  );
}
