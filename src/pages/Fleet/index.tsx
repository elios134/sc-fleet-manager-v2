import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import Button from "../../components/ui/Button";
import { usePersistentState } from "../../lib/uiPersist";
import { useToast } from "../../components/Toast";
import { RSI_CATEGORIES, normalizeRsiCategory, type RsiCategory } from "../../lib/shipCategory";
import { fetchShip3DIndex, findShipModel, hasVisitableInterior, indexShipsByName, type Ship3DShip } from "../../lib/ship3d";
import { formatUsd, shipInsRank } from "./helpers";
import FleetToolbar from "./components/FleetToolbar";
import { FleetKpis } from "./components/FleetKpis";
import { FleetTable } from "./components/FleetTable";
import { FleetShipModal } from "./components/FleetShipModal";
import AddShipModal from "./components/AddShipModal";
import type { FleetFilter, FleetStats, ShipRow, SortKey } from "./types";

export type { ShipRow } from "./types";

/* Onglet « Ma flotte » (maquette docs/design/maquettes-refonte-pages.html, variante A) : bandeau
   de chiffres, liste triable et filtrable ; un clic sur un vaisseau ouvre sa fiche en fenêtre
   (specs, assurance, pack, raccourcis Loadout / 3D / Assurances, location, suppression). */
export default function FleetPage() {
  const { t } = useTranslation();
  const [ships, setShips] = useState<ShipRow[]>([]);
  const [stats, setStats] = useState<FleetStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noAccount, setNoAccount] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [search, setSearch] = usePersistentState("fleet.search", "");
  const [filter, setFilter] = usePersistentState<FleetFilter>("fleet.filter", "ALL");
  const [sortKey, setSortKey] = usePersistentState<SortKey>("fleet.sort", "value");
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  // Modèles 3D (asset-3D) : pour signaler un intérieur visitable. Vide si l'index est injoignable.
  const [models, setModels] = useState<Map<string, Ship3DShip>>(new Map());
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

  const selected = ships.find((s) => s.id === selectedId) ?? null;

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
      setSelectedId(null);
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
    void fetchShip3DIndex().then((idx) => setModels(indexShipsByName(idx)));
  }, []);

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
          <FleetKpis ships={ships} stats={stats} />
          <FleetToolbar search={search} setSearch={setSearch} chips={chips} filter={filter} setFilter={setFilter} sortKey={sortKey} setSortKey={setSortKey} t={t} />

          {filteredShips.length === 0 ? (
            <p className="p-12 text-center text-white/50">{t("fleet.noShipMatch")}</p>
          ) : (
            <div className="glass overflow-x-auto rounded-2xl px-1.5 py-1">
              <FleetTable ships={sortedShips} selectedId={selected?.id ?? null} onSelect={(s) => setSelectedId(s.id)} />
            </div>
          )}
        </>
      )}

      {selected && (
        <FleetShipModal
          key={selected.id}
          ship={selected}
          visitable={hasVisitableInterior(findShipModel(models, selected.name))}
          onClose={() => setSelectedId(null)}
          onDelete={selected.acquisition !== "rsi" ? () => void handleDeleteShip(selected.id) : undefined}
          onExtend={selected.acquisition === "rented" ? (d) => void handleExtendRental(selected.id, d) : undefined}
        />
      )}
      {addOpen && <AddShipModal onClose={() => setAddOpen(false)} onAdd={handleAddShip} />}
    </div>
  );
}
