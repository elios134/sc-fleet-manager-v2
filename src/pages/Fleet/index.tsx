import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import Button from "../../components/ui/Button";
import ShipDetailsModal from "../../components/ShipDetailsModal";
import { usePersistentState } from "../../lib/uiPersist";
import { useToast } from "../../components/Toast";
import { RSI_CATEGORIES, normalizeRsiCategory, type RsiCategory } from "../../lib/shipCategory";
import { formatUsd, shipInsRank } from "./helpers";
import FleetStatsRow from "./components/FleetStatsRow";
import FleetToolbar from "./components/FleetToolbar";
import FleetShipCard from "./components/FleetShipCard";
import AddShipModal from "./components/AddShipModal";
import type { FleetFilter, FleetStats, ShipRow, ShipView, SortKey } from "./types";

export type { ShipRow } from "./types";

/* Onglet « Flotte » — refonte « Hangar Dashboard » : héro de synthèse (valeur / vaisseaux /
   LTI / prochaine expiration) au-dessus d'une grille de cartes image-forward où assurance et
   mode d'acquisition se lisent d'un coup d'œil. */
export default function FleetPage() {
  const { t } = useTranslation();
  const [ships, setShips] = useState<ShipRow[]>([]);
  const [stats, setStats] = useState<FleetStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noAccount, setNoAccount] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [detailShip, setDetailShip] = usePersistentState<ShipRow | null>("fleet.detailShip", null);
  const [search, setSearch] = usePersistentState("fleet.search", "");
  const [filter, setFilter] = usePersistentState<FleetFilter>("fleet.filter", "ALL");
  const [sortKey, setSortKey] = usePersistentState<SortKey>("fleet.sort", "value");
  const [view, setView] = usePersistentState<ShipView>("fleet.view", "grid");
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const location = useLocation();
  const { toast } = useToast();

  const shipCat = (s: ShipRow): RsiCategory | null => normalizeRsiCategory(s.shipDataRole);

  const q = search.trim().toLowerCase();
  const filteredShips = ships.filter((s) => {
    if (filter === "LTI" && s.lti !== 1) return false;
    if (filter !== "ALL" && filter !== "LTI" && shipCat(s) !== filter) return false;
    if (q && !(s.name.toLowerCase().includes(q) || s.manufacturer.toLowerCase().includes(q))) return false;
    return true;
  });

  // Chips : Tous + LTI + les catégories RSI PRÉSENTES dans la flotte.
  const presentCats = RSI_CATEGORIES.filter((c) => ships.some((s) => shipCat(s) === c));
  const chips: ReadonlyArray<readonly [string, FleetFilter]> = [
    [t("fleet.chipAll"), "ALL"],
    ["LTI", "LTI"],
    ...presentCats.map((c) => [c, c] as const),
  ];

  const sortedShips = [...filteredShips].sort((a, b) => {
    if (sortKey === "name") return a.name.localeCompare(b.name);
    if (sortKey === "ins") return shipInsRank(a) - shipInsRank(b);
    return (b.currentValueUsd ?? -1) - (a.currentValueUsd ?? -1);
  });

  // ── Acquisition : ajout / suppression / prolongation ──
  async function handleAddShip(shipDataId: number, mode: "bought" | "rented", rentalDays?: number) {
    if (!activeAccountId) return;
    try {
      await invoke("add_fleet_ship", { accountId: activeAccountId, shipDataId, mode, rentalDays: rentalDays ?? null });
      setAddOpen(false);
      setReloadTick((n) => n + 1);
    } catch (err) {
      toast({ type: "error", title: t("fleet.addShip"), message: err instanceof Error ? err.message : String(err) });
    }
  }
  async function handleDeleteShip(shipId: number) {
    try {
      await invoke("delete_fleet_ship", { shipId });
      setReloadTick((n) => n + 1);
    } catch (err) {
      toast({ type: "error", title: t("shipCard.remove"), message: err instanceof Error ? err.message : String(err) });
    }
  }
  async function handleExtendRental(shipId: number, addDays: number) {
    try {
      await invoke("extend_ship_rental", { shipId, addDays });
      setReloadTick((n) => n + 1);
    } catch (err) {
      toast({ type: "error", title: t("shipCard.addDays"), message: err instanceof Error ? err.message : String(err) });
    }
  }

  useEffect(() => {
    const pending = listen("fleet:synced", () => setReloadTick((n) => n + 1));
    return () => {
      void pending.then((un) => un());
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const accountId = await invoke<string | null>("get_active_account_id");
        if (!accountId) {
          if (!cancelled) setNoAccount(true);
          return;
        }
        const [shipsData, statsData] = await Promise.all([
          invoke<ShipRow[]>("get_ships", { accountId }),
          invoke<FleetStats>("get_fleet_stats", { accountId }),
        ]);
        if (!cancelled) {
          setNoAccount(false);
          setShips(shipsData);
          setStats(statsData);
          setActiveAccountId(accountId);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [location.key, reloadTick]);

  if (!loading && noAccount) {
    return (
      <div className="h-full p-6 text-white">
        <p className="p-12 text-center text-white/50">
          {t("fleet.noActiveAccount")}{" "}
          <Link to="/" className="text-[var(--accent)] underline">
            {t("fleet.selectCommander")}
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6 text-white">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t("fleet.subtitle")}</h1>
          <p className="mt-1 text-sm text-white/45">
            {t("fleet.shipsCount", { count: ships.length })}
            {stats ? ` · ${formatUsd(stats.totalFleetValueUsd)}` : ""}
          </p>
        </div>
        <Button
          variant="secondary"
          onClick={() => setAddOpen(true)}
          disabled={!activeAccountId}
          title={t("fleet.addShip")}
          className="border-[var(--accent)]/50 bg-transparent text-[var(--accent)] hover:bg-[var(--accent)]/10"
        >
          ＋ {t("fleet.addShip")}
        </Button>
      </header>

      {loading && <p className="p-12 text-center text-white/50">{t("fleet.loading2")}</p>}
      {!loading && error && <p className="p-12 text-center text-red-400">{t("fleet.error", { message: error })}</p>}
      {!loading && !error && ships.length === 0 && <p className="p-12 text-center text-white/50">{t("fleet.noShipsForAccount")}</p>}

      {!loading && !error && ships.length > 0 && (
        <>
          {stats && <FleetStatsRow stats={stats} shipCount={ships.length} />}
          <FleetToolbar
            search={search}
            setSearch={setSearch}
            chips={chips}
            filter={filter}
            setFilter={setFilter}
            sortKey={sortKey}
            setSortKey={setSortKey}
            view={view}
            setView={setView}
            t={t}
          />

          {filteredShips.length === 0 ? (
            <p className="p-12 text-center text-white/50">{t("fleet.noShipMatch")}</p>
          ) : (
            <div
              className={
                view === "list"
                  ? "grid gap-2.5"
                  : "grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]"
              }
            >
              {sortedShips.map((ship) => (
                <FleetShipCard
                  key={ship.id}
                  ship={ship}
                  view={view}
                  onClick={() => setDetailShip(ship)}
                  onDelete={ship.acquisition !== "rsi" ? () => void handleDeleteShip(ship.id) : undefined}
                  onExtend={ship.acquisition === "rented" ? (d) => void handleExtendRental(ship.id, d) : undefined}
                />
              ))}
            </div>
          )}
        </>
      )}

      {detailShip && <ShipDetailsModal ship={detailShip} onClose={() => setDetailShip(null)} />}
      {addOpen && <AddShipModal onClose={() => setAddOpen(false)} onAdd={handleAddShip} />}
    </div>
  );
}
