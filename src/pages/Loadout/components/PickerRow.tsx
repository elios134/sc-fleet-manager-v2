import { Hammer, Package, ShoppingCart } from "lucide-react";
import { useTranslation } from "react-i18next";
import { type ComponentRow, type StatSpec } from "../types";
import { gradeColor, getStat, formatStat } from "../helpers";
import { AcqIcon } from "./AcqIcon";

export function PickerRow({
  comp,
  specs,
  current,
  onSelect,
  onShowAcq,
}: {
  comp: ComponentRow;
  specs: StatSpec[];
  current: string | null;
  onSelect: () => void;
  onShowAcq: (comp: ComponentRow, kind: "buy" | "craft" | "stock") => void;
}) {
  const { t } = useTranslation();
  const isActive = comp.className != null && comp.className === current;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => e.key === "Enter" && onSelect()}
      className="flex w-full cursor-pointer items-center gap-4 px-6 py-3 text-left transition-colors hover:bg-white/[0.04]"
      style={{
        background: isActive ? "rgba(96,165,250,0.10)" : undefined,
        borderBottom: "1px solid rgba(255,255,255,0.04)",
        borderLeft: `2px solid ${isActive ? "#60a5fa" : "transparent"}`,
      }}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-sm" style={{ color: isActive ? "#60a5fa" : "#fff" }}>
          {comp.name}
        </div>
        {(comp.manufacturer || comp.class) && (
          <div className="mt-0.5 truncate text-[10px] text-white/40">
            {[comp.manufacturer, comp.class].filter(Boolean).join(" · ")}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white/60"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
        >
          S{comp.size}
        </span>
        {comp.grade && (
          <span
            className="rounded px-1.5 py-0.5 text-center text-[10px] font-semibold"
            style={{ color: "#000", background: gradeColor(comp.grade), minWidth: "22px" }}
          >
            {comp.grade}
          </span>
        )}
      </div>
      {/* Acquisition (Lot 5) : icônes cliquables → mini-modale détail. Grisé si donnée inconnue. */}
      <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <AcqIcon
          Icon={ShoppingCart}
          on={comp.buyable === 1}
          color="#34d399"
          label={comp.buyable === 1 ? t("loadout.acqBuy") : t("loadout.acqNotBuy")}
          onShow={() => onShowAcq(comp, "buy")}
        />
        <AcqIcon
          Icon={Hammer}
          on={comp.craftable === 1}
          color="#fbbf24"
          label={comp.craftable === 1 ? t("loadout.acqCraft") : t("loadout.acqNotCraft")}
          onShow={() => onShowAcq(comp, "craft")}
        />
        <AcqIcon
          Icon={Package}
          on={!!comp.stockShips}
          color="#93c5fd"
          label={comp.stockShips ? t("loadout.acqStock") : t("loadout.acqNotStock")}
          onShow={() => onShowAcq(comp, "stock")}
        />
      </div>
      <div className="flex shrink-0 items-center gap-5">
        {specs.map((s) => (
          <div key={s.key} className="text-right" style={{ minWidth: "48px" }}>
            <div className="font-mono text-[12px] text-white">{formatStat(getStat(comp, s.key), s)}</div>
            <div className="text-[9px] font-semibold uppercase tracking-wider text-white/40">
              {t(s.labelKey)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
