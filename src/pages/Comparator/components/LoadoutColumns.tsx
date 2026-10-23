import { useTranslation } from "react-i18next";
import Dropdown, { type DropdownGroup } from "../../../components/ui/Dropdown";
import { appLocale } from "../../../lib/format";
import type { ShipDataRow } from "../compare";
import type { LoadoutCompare } from "../hooks/useLoadoutCompare";
import { COL_BAR, COL_EDGE } from "./loadoutColors";

const num = (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toLocaleString(appLocale()));

/** Les 3 colonnes : vaisseau (flotte d'abord) et profil (stock ou profil sauvegardé). */
export function LoadoutColumns({ lc, ships }: { lc: LoadoutCompare; ships: ShipDataRow[] }) {
  const { t } = useTranslation();
  const opt = (s: ShipDataRow) => ({ value: String(s.id), label: `${s.name} — ${s.manufacturer}` });
  const mine = ships.filter((s) => lc.isOwned(s.id));
  const groups: DropdownGroup[] = mine.length
    ? [
        { label: t("comparator.myShips"), options: mine.map(opt) },
        { label: t("comparator.catalog"), options: ships.filter((s) => !lc.isOwned(s.id)).map(opt) },
      ]
    : [{ options: ships.map(opt) }];
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {lc.columns.map((c, i) => (
        <section key={i} className={`glass flex flex-col gap-2.5 rounded-2xl border-l-[3px] px-4 py-3.5 ${COL_EDGE[i]}`}>
          <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.1em] text-white/55">
            <span className={`h-2.5 w-2.5 rounded-full ${COL_BAR[i]}`} />
            {i === 0 ? t("comparator.lo.reference") : t("comparator.lo.compared", { n: i })}
          </p>
          <Dropdown
            value={c.col.shipDataId != null ? String(c.col.shipDataId) : ""}
            onChange={(id) => lc.setShip(i, id ? Number(id) : null)}
            placeholder={t("comparator.selectShipOption")}
            searchable
            searchPlaceholder={t("common.searchPlaceholder")}
            buttonClassName="rounded-xl px-3 py-2"
            groups={groups}
            ariaLabel={t("comparator.lo.ship", { n: i + 1 })}
          />
          <select
            value={String(c.col.profile)}
            disabled={c.col.shipDataId == null}
            onChange={(e) => lc.setProfile(i, e.target.value === "stock" ? "stock" : Number(e.target.value))}
            aria-label={t("comparator.lo.profile", { n: i + 1 })}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[12.5px] text-white disabled:opacity-40"
          >
            <option value="stock">{t("comparator.lo.stock")}</option>
            {c.profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.profileName}
              </option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-1.5">
            {[
              [t("comparator.lo.dps"), num(c.stats?.dps)],
              [t("comparator.lo.shieldHp"), num(c.stats?.shieldHp)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg border border-white/[0.07] bg-white/[0.03] px-2.5 py-1.5">
                <span className="block text-[10px] uppercase tracking-wider text-white/40">{k}</span>
                <b className="font-mono text-[13px] text-white">{v}</b>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
