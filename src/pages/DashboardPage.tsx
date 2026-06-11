import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Loader2 } from "lucide-react";

type RecentShip = {
  id: number;
  name: string;
  manufacturer: string | null;
  imageUrl: string | null;
  shipDataRole: string | null;
  shipDataClassification: string | null;
};

type DashboardData = {
  shipsCount: number;
  totalValueUsd: number;
  ltiCount: number;
  lastSyncedAt: string | null;
  recentShips: RecentShip[];
};

function formatUsd(value: number): string {
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })} USD`;
}

function formatRelative(raw: string | null): string {
  if (!raw) return "—";
  // SQLite datetime('now') renvoie de l'UTC sans suffixe ("YYYY-MM-DD HH:MM:SS").
  const parsed = new Date(raw.replace(" ", "T") + "Z");
  if (Number.isNaN(parsed.getTime())) return raw;
  const diffMs = Date.now() - parsed.getTime();
  const min = Math.round(diffMs / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.round(hours / 24);
  return `il y a ${days} j`;
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noAccount, setNoAccount] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  // Recharge le dashboard après une synchronisation RSI (événement émis par Settings).
  useEffect(() => {
    const pending = listen("fleet:synced", () => setReloadTick((t) => t + 1));
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
        const result = await invoke<DashboardData>("get_dashboard_data", { accountId });
        if (!cancelled) {
          setNoAccount(false);
          setData(result);
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
      <div className="p-8">
        <p className="text-white/50">
          Aucun compte actif.{" "}
          <Link to="/" className="text-[var(--accent)] hover:underline">
            Sélectionner un commandant
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="p-8">
      <header className="mb-6">
        <p className="text-xs uppercase tracking-[0.18em] text-white/40">Dashboard</p>
        <h1 className="text-2xl font-bold text-white">COMMAND POST</h1>
      </header>

      {loading && (
        <div className="flex items-center gap-2 text-white/50">
          <Loader2 className="h-4 w-4 animate-spin" />
          Chargement…
        </div>
      )}

      {!loading && error && (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          Erreur : {error}
        </p>
      )}

      {!loading && !error && data && (
        <>
          {/* Stats */}
          <section className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard label="Vaisseaux" value={String(data.shipsCount)} />
            <StatCard label="Valeur flotte" value={formatUsd(data.totalValueUsd)} />
            <StatCard label="Assets LTI" value={String(data.ltiCount)} />
          </section>

          {/* Quick Launch Bay */}
          <section className="mb-8">
            <header className="mb-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-white/80">
                Quick Launch Bay
              </h2>
              <p className="text-sm text-white/40">Vaisseaux récents</p>
            </header>

            {data.recentShips.length === 0 ? (
              <p className="text-sm text-white/40">Aucun vaisseau enregistré</p>
            ) : (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
                {data.recentShips.map((ship) => (
                  <MiniShipCard key={ship.id} ship={ship} onClick={() => navigate("/fleet")} />
                ))}
              </div>
            )}
          </section>

          {/* Dernière sync */}
          <section className="text-sm text-white/50">
            Dernière synchronisation : {formatRelative(data.lastSyncedAt)}
          </section>
        </>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <p className="text-xs uppercase tracking-wider text-white/40">{label}</p>
      <p className="mt-1 text-2xl font-bold text-white">{value}</p>
    </div>
  );
}

function MiniShipCard({ ship, onClick }: { ship: RecentShip; onClick: () => void }) {
  const role = ship.shipDataRole ?? ship.shipDataClassification ?? "—";
  return (
    <button
      onClick={onClick}
      className="group flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/5 text-left transition-colors hover:bg-white/10"
    >
      {ship.imageUrl ? (
        <img
          src={ship.imageUrl}
          alt={ship.name}
          className="h-24 w-full object-cover"
        />
      ) : (
        <div className="flex h-24 w-full items-center justify-center bg-white/5 text-xs text-white/30">
          Pas d'image
        </div>
      )}
      <div className="p-3">
        <p className="truncate text-sm font-medium text-white">{ship.name}</p>
        <p className="truncate text-xs text-white/40">{role}</p>
      </div>
    </button>
  );
}
