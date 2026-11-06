import { useTranslation } from "react-i18next";
import { ArrowLeftRight } from "lucide-react";
import Dropdown, { type DropdownGroup, type DropdownOption } from "../../../components/ui/Dropdown";
import type { ShipDataRow } from "../compare";

/** Liste d'un côté du duel : « Mes vaisseaux » en tête ; le vaisseau choisi reste proposé même si
 *  le filtre l'écarte, pour que le champ affiche toujours son nom. */
function ShipSelect({ label, value, ships, ownedNames, onChange }: { label: string; value: ShipDataRow | null; ships: ShipDataRow[]; ownedNames: Set<string>; onChange: (id: string) => void }) {
  const { t } = useTranslation();
  const list = value && !ships.some((s) => s.id === value.id) ? [value, ...ships] : ships;
  const owned = list.filter((s) => ownedNames.has(s.name.toLowerCase()));
  const others = list.filter((s) => !ownedNames.has(s.name.toLowerCase()));
  const opt = (s: ShipDataRow): DropdownOption => ({ value: String(s.id), label: `${s.name} — ${s.manufacturer}` });
  const groups: DropdownGroup[] =
    owned.length > 0
      ? [
          { label: t("comparator.myShips"), options: owned.map(opt) },
          { label: t("comparator.catalog"), options: others.map(opt) },
        ]
      : [{ options: others.map(opt) }];
  return (
    <label className="flex min-w-[220px] flex-1 flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/40">{label}</span>
      <Dropdown
        value={value ? String(value.id) : ""}
        onChange={onChange}
        placeholder={t("comparator.selectShipOption")}
        searchable
        searchPlaceholder={t("common.searchPlaceholder")}
        groups={groups}
        ariaLabel={label}
      />
    </label>
  );
}

/** Ligne de sélection du duel : filtre, vaisseau A, échange, vaisseau B, réinitialiser. */
export function DuelBar({
  search,
  setSearch,
  ships,
  ownedNames,
  shipA,
  shipB,
  onPickA,
  onPickB,
  onSwap,
  onReset,
}: {
  search: string;
  setSearch: (v: string) => void;
  ships: ShipDataRow[];
  ownedNames: Set<string>;
  shipA: ShipDataRow | null;
  shipB: ShipDataRow | null;
  onPickA: (id: string) => void;
  onPickB: (id: string) => void;
  onSwap: () => void;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  const empty = !shipA && !shipB;
  return (
    <section className="glass relative z-30 mb-4 flex flex-wrap items-end gap-3 rounded-2xl px-4 py-3.5">
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t("comparator.filterPlaceholder")}
        aria-label={t("comparator.filterPlaceholder")}
        className="w-48 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:border-[var(--accent)]/60 focus:outline-none"
      />
      <ShipSelect label={t("comparator.shipA")} value={shipA} ships={ships} ownedNames={ownedNames} onChange={onPickA} />
      <button
        type="button"
        onClick={onSwap}
        disabled={empty}
        title={t("comparator.swapTitle")}
        aria-label={t("comparator.swapTitle")}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/70 transition-colors hover:bg-white/10 disabled:opacity-40"
      >
        <ArrowLeftRight className="h-4 w-4" />
      </button>
      <ShipSelect label={t("comparator.shipB")} value={shipB} ships={ships} ownedNames={ownedNames} onChange={onPickB} />
      <button
        type="button"
        onClick={onReset}
        disabled={empty}
        className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-white/80 transition-colors hover:bg-white/10 disabled:opacity-40"
      >
        {t("comparator.resetBtn")}
      </button>
    </section>
  );
}
