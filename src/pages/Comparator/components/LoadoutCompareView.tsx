import { useTranslation } from "react-i18next";
import type { ShipDataRow } from "../compare";
import { useLoadoutCompare } from "../hooks/useLoadoutCompare";
import { LoadoutColumns } from "./LoadoutColumns";
import { LoadoutMetrics } from "./LoadoutMetrics";
import { EquipmentDiffTable } from "./EquipmentDiffTable";

/** Mode « Loadouts » : 3 colonnes, performances comparées à la référence, équipement. */
export function LoadoutCompareView({ ships }: { ships: ShipDataRow[] }) {
  const { t } = useTranslation();
  const lc = useLoadoutCompare(ships);
  const ready = lc.columns.filter((c) => c.ship && c.slots);
  return (
    <div className="flex flex-col gap-4">
      <LoadoutColumns lc={lc} ships={ships} />
      {ready.length < 2 ? (
        <p className="text-sm text-white/40">{t("comparator.lo.pickTwo")}</p>
      ) : (
        <>
          <LoadoutMetrics stats={lc.columns.map((c) => c.stats)} />
          <EquipmentDiffTable
            heads={lc.columns.map((c) => (c.ship ? `${c.ship.name} · ${c.profileName ?? t("comparator.lo.stock")}` : "—"))}
            cols={lc.columns.map((c) => c.slots ?? [])}
          />
        </>
      )}
    </div>
  );
}
