import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
import Dropdown, { type DropdownOption } from "../../../components/ui/Dropdown";
import { shipChoices, type ShipFilter } from "../lib/chain";
import { fmtMoney } from "../helpers";
import type { CcuShip } from "../types";

const label = "mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/40";
const FILTERS = [
  ["owned", "ccu.filterOwned"],
  ["available", "ccu.filterAvailable"],
  ["warbond", "ccu.filterWarbond"],
] as const;
/** Libellé d'un vaisseau : nom, prix, et étiquettes MSRP (prix catalogue, pas de CCU) / warbond. */
const option = (s: CcuShip, warbond: string): DropdownOption => ({
  value: String(s.shipId),
  searchText: s.name,
  label: (
    <>
      {s.name}
      {s.priceCents != null && <span className="text-white/50"> · {fmtMoney(s.priceCents)}</span>}
      {s.priceSource === "msrp" && <span className="ml-1.5 text-[10px] text-white/40">MSRP</span>}
      {s.isWarbondPrice && (
        <span className="ml-1.5 rounded-full border border-[var(--amber)]/40 bg-[var(--amber-muted)] px-1.5 py-px text-[9.5px] font-bold uppercase tracking-wider text-[var(--amber)]">{warbond}</span>
      )}
    </>
  ),
});

/** Choix d'un vaisseau dans une liste cherchable : ceux de la flotte en tête, filtres
 *  (ma flotte, disponibles, warbond), pastille « dans ta flotte » si le vaisseau est possédé. */
function ShipField({ title, ships, mode, value, onChange }: { title: string; ships: CcuShip[]; mode: "from" | "to"; value: CcuShip | null; onChange: (id: number) => void }) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<ShipFilter>({});
  // Recalculée à chaque rendu : les prix des libellés suivent la TVA d'affichage (fmtMoney).
  const c = shipChoices(ships, mode, filter, value?.shipId);
  const groups = [
    { label: t("ccu.inFleet"), options: c.owned.map((x) => option(x, t("ccu.filterWarbond"))) },
    { label: t("ccu.otherShips"), options: c.others.map((x) => option(x, t("ccu.filterWarbond"))) },
  ].filter((g) => g.options.length > 0);

  return (
    <div className="min-w-[240px] flex-1">
      <p className={label}>{title}</p>
      <div className="flex items-center gap-2">
        <Dropdown
          value={value ? String(value.shipId) : ""}
          onChange={(v) => onChange(Number(v))}
          groups={groups}
          placeholder={groups.length === 0 ? t("ccu.noShipMatch") : t("ccu.pickShip")}
          searchable
          searchPlaceholder={t("ccu.searchShipPlaceholder")}
          className="min-w-0 flex-1"
          ariaLabel={title}
        />
        {value?.isOwned && (
          <span className="shrink-0 rounded-full border border-emerald-400/40 px-2 py-0.5 text-[10.5px] text-emerald-300">{t("ccu.inFleet")}</span>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {FILTERS.map(([key, labelKey]) => (
          <button
            key={key}
            type="button"
            aria-pressed={!!filter[key]}
            onClick={() => setFilter((f) => ({ ...f, [key]: !f[key] }))}
            className={`rounded-full border px-2.5 py-0.5 text-[11px] transition-colors ${filter[key] ? "border-[var(--accent)]/60 bg-[var(--accent-muted)] text-white" : "border-white/10 text-white/55 hover:bg-white/5"}`}
          >
            {t(labelKey)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** En-tête de la page CCU : « Je pars de » → « Je veux », et le prix de la montée directe. */
export function ShipSelectRow({
  ships,
  from,
  to,
  onFrom,
  onTo,
  directCostCents,
}: {
  ships: CcuShip[];
  from: CcuShip | null;
  to: CcuShip | null;
  onFrom: (id: number) => void;
  onTo: (id: number) => void;
  directCostCents: number | null;
}) {
  const { t } = useTranslation();
  return (
    <section className="glass relative z-30 mt-5 flex flex-wrap items-end gap-4 rounded-2xl px-4 py-3.5">
      <ShipField title={t("ccu.iStartFrom")} ships={ships} mode="from" value={from} onChange={onFrom} />
      <ArrowRight className="mb-10 h-5 w-5 shrink-0 text-white/30" />
      <ShipField title={t("ccu.iWant")} ships={ships} mode="to" value={to} onChange={onTo} />
      <div className="mb-8 ml-auto text-right">
        <p className={label}>{t("ccu.directUpgrade")}</p>
        <b className="text-lg tabular-nums text-white">{directCostCents != null ? fmtMoney(directCostCents) : "—"}</b>
      </div>
    </section>
  );
}
