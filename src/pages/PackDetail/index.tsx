import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { ArrowLeft, Loader2, Search } from "lucide-react";
import ShipDetailsModal from "../../components/ShipDetailsModal";
import { ShowMore } from "../../components/ui/ShowMore";
import type { ShipRow } from "../Fleet";
import { filterPackShips, toShipRow } from "./lib/packView";
import { PackShipsTable } from "./components/PackShipsTable";
import type { PackDetail } from "./types";

const INITIAL_VISIBLE = 10;
const LOAD_MORE_BATCH = 20;

const PLEDGE_TYPE_LABEL_KEYS: Record<string, string> = {
  game_package: "pack.pledgeType.gamePackage",
  standalone_ship: "pack.pledgeType.standaloneShip",
  cosmetic: "pack.pledgeType.cosmetic",
};

function pledgeTypeLabel(type: string, t: TFunction): string {
  const key = PLEDGE_TYPE_LABEL_KEYS[type];
  return key ? t(key) : type;
}

function formatUsd(value: number | null): string {
  if (value == null) return "—";
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })} USD`;
}

/* Page d'un pack (maquette docs/design/maquettes-refonte-pages-2.html, variante A, comme Ma flotte) :
   chiffres du pack, tableau des vaisseaux, fiche en fenêtre au clic. */
export default function PackDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pledgeId } = useParams();
  const id = Number(pledgeId);

  const [data, setData] = useState<PackDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);
  const [detailShip, setDetailShip] = useState<ShipRow | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    if (Number.isNaN(id)) {
      setError(t("pack.invalidId"));
      setLoading(false);
      return;
    }
    invoke<PackDetail>("get_pack_detail", { pledgeId: id })
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, t]);

  useEffect(() => setVisibleCount(INITIAL_VISIBLE), [search]);

  const filteredShips = useMemo(() => filterPackShips(data?.ships ?? [], search), [data, search]);
  const visibleShips = filteredShips.slice(0, visibleCount);

  const back = (
    <button onClick={() => navigate("/fleet")} className="inline-flex items-center gap-1 text-[var(--accent)] hover:underline">
      <ArrowLeft className="h-4 w-4" /> {t("pack.breadcrumbMyFleet")}
    </button>
  );

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-8 text-white/50">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("pack.loadingPack")}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-8">
        <div className="mb-4 text-sm">{back}</div>
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">{error ?? t("pack.notFoundMsg")}</p>
      </div>
    );
  }

  const tiles: Array<[string, string]> = [
    [t("pack.statShips2"), String(data.shipsCount)],
    [t("pack.statLtiShips2"), String(data.ltiShipsCount)],
    [t("pack.statManufacturers2"), String(data.manufacturersCount)],
    [t("pack.statValue2"), formatUsd(data.currentValueUsd)],
  ];

  return (
    <div className="p-8">
      <div className="mb-3 flex items-center gap-2 text-sm">
        {back}
        <span className="text-white/30">/</span>
        <span className="font-medium text-white/80">{data.pledgeName}</span>
      </div>

      <header className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-white">{data.pledgeName}</h1>
          <p className="mt-0.5 text-sm text-white/50">
            {pledgeTypeLabel(data.pledgeType, t)} · {t("pack.shipsIncludedLine", { n: data.shipsCount })}
            {data.createdDate ? ` · ${t("pack.acquiredOnLine", { date: data.createdDate })}` : ""}
            {data.isUpgraded === 1 ? ` · ${t("pack.upgradedCcuLine")}` : ""}
          </p>
        </div>
        <label className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("pack.searchPlaceholder")}
            className="w-full rounded-lg border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-sm text-white placeholder:text-white/40 focus:border-[var(--accent)]/60 focus:outline-none"
          />
        </label>
      </header>

      <div className="mb-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {tiles.map(([label, value]) => (
          <div key={label} className="glass rounded-2xl px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-white/40">{label}</p>
            <p className="mt-0.5 text-[20px] font-bold tabular-nums text-white">{value}</p>
          </div>
        ))}
      </div>

      <p className="mb-2 text-xs uppercase tracking-wider text-white/40">{t("pack.shipsCountLine", { visible: visibleShips.length, total: filteredShips.length })}</p>

      <div className="glass overflow-x-auto rounded-2xl px-1.5 py-1">
        <PackShipsTable ships={visibleShips} onOpen={(s) => setDetailShip(toShipRow(s))} />
        <ShowMore rest={filteredShips.length - visibleCount} step={LOAD_MORE_BATCH} onMore={() => setVisibleCount((c) => c + LOAD_MORE_BATCH)} />
      </div>

      {detailShip && <ShipDetailsModal ship={detailShip} onClose={() => setDetailShip(null)} />}
    </div>
  );
}
