import { Fuel } from "lucide-react";
import { type TFunction } from "i18next";

function FuelBadge({ fuelScu, over, t }: { fuelScu: number | null; over?: boolean; t: TFunction }) {
  return (
    <span
      title={over ? t("cargo.gps.refuelTitle") : t("cargo.gps.fuelTitle")}
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${
        over ? "border-red-400/40 bg-red-400/10 text-red-300" : "border-sky-400/30 bg-sky-400/10 text-sky-300"
      }`}
    >
      <Fuel className="h-3 w-3" />
      {fuelScu != null ? `${fuelScu.toFixed(2)} SCU` : "—"}
      {over && ` · ${t("cargo.gps.refuelNeeded")}`}
    </span>
  );
}

export { FuelBadge };
