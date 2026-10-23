import { useTranslation } from "react-i18next";
import { equipmentDiff, type EquipSlot } from "../lib/loadouts";
import { COL_BAR } from "./loadoutColors";

const GROUP_KEY: Record<string, string> = {
  WEAPON: "comparator.lo.group.weapons",
  MISSILE: "comparator.lo.group.missiles",
  SHIELD: "comparator.lo.group.shields",
  POWER_PLANT: "comparator.lo.group.power",
  COOLER: "comparator.lo.group.coolers",
  QUANTUM_DRIVE: "comparator.lo.group.quantum",
};

/** Différences d'équipement par famille ; ce qui diffère de la référence est mis en avant. */
export function EquipmentDiffTable({ heads, cols }: { heads: string[]; cols: EquipSlot[][] }) {
  const { t } = useTranslation();
  const rows = equipmentDiff(cols);
  return (
    <section className="glass overflow-x-auto rounded-2xl px-4 py-3.5" aria-label={t("comparator.lo.diff")}>
      <h3 className="mb-2 text-[11px] font-bold uppercase tracking-[0.1em] text-white/55">{t("comparator.lo.diff")}</h3>
      <table className="w-full min-w-[560px] text-left text-[12.5px]">
        <thead>
          <tr className="text-[10.5px] uppercase tracking-wider text-white/40">
            <th className="py-1.5 pr-3 font-semibold">{t("comparator.lo.slot")}</th>
            {heads.map((h, i) => (
              <th key={i} className="py-1.5 pr-3 font-semibold">
                <span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${COL_BAR[i]}`} />
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.group} className="border-t border-white/[0.06] align-top">
              <td className={`py-2 pr-3 ${r.differs ? "font-semibold text-white/75" : "text-white/45"}`}>{t(GROUP_KEY[r.group] ?? r.group)}</td>
              {r.values.map((v, i) => (
                <td key={i} className={`py-2 pr-3 ${i > 0 && v !== r.values[0] ? "text-amber-300" : "text-white/80"}`}>
                  {v}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
