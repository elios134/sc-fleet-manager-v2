import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { ArrowLeft, Loader2, Search } from "lucide-react";
import ShipDetailsModal from "../components/ShipDetailsModal";
import type { ShipRow } from "./FleetPage";

/* ── Types ── */

type PackShip = {
  shipId: number | null;
  shipName: string;
  manufacturer: string;
  role: string | null;
  lti: number | null;
  insuranceDuration: number | null;
  insuranceExpiry: string | null;
  imageUrl: string | null;
};

type PackDetail = {
  pledgeId: number;
  pledgeName: string;
  pledgeType: string;
  createdDate: string | null;
  currentValueUsd: number | null;
  isUpgraded: number;
  shipsCount: number;
  ltiShipsCount: number;
  manufacturersCount: number;
  ships: PackShip[];
};

const INITIAL_VISIBLE = 10;
const LOAD_MORE_BATCH = 20;

const PLEDGE_TYPE_LABELS: Record<string, string> = {
  game_package: "Pack de jeu",
  standalone_ship: "Achat individuel",
  cosmetic: "Cosmétique",
};

function formatUsd(value: number | null): string {
  if (value == null) return "—";
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })} USD`;
}

// Construit un ShipRow (forme attendue par ShipDetailsModal) depuis un PackShip.
function toShipRow(s: PackShip): ShipRow {
  return {
    id: s.shipId!,
    name: s.shipName,
    manufacturer: s.manufacturer,
    role: s.role ?? "MULTI",
    lti: s.lti ?? 0,
    insuranceDuration: s.insuranceDuration,
    insuranceExpiry: s.insuranceExpiry,
    imageUrl: s.imageUrl,
    imageTopDownUrl: null,
    shipDataRole: null,
    shipDataManufacturer: null,
    shipDataClassification: null,
  };
}

export default function PackDetailPage() {
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
      setError("Identifiant de pack invalide.");
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
  }, [id]);

  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE);
  }, [search]);

  const filteredShips = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    if (!q) return data.ships;
    return data.ships.filter(
      (s) =>
        s.shipName.toLowerCase().includes(q) || s.manufacturer.toLowerCase().includes(q),
    );
  }, [data, search]);

  const visibleShips = filteredShips.slice(0, visibleCount);
  const hasMore = filteredShips.length > visibleCount;

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-8 text-white/50">
        <Loader2 className="h-4 w-4 animate-spin" />
        Chargement du pack…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-8">
        <button
          onClick={() => navigate("/fleet")}
          className="mb-4 inline-flex items-center gap-1 text-sm text-[var(--accent)] hover:underline"
        >
          <ArrowLeft className="h-4 w-4" /> My Fleet
        </button>
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          {error ?? "Pack introuvable."}
        </p>
      </div>
    );
  }

  return (
    <div className="p-8">
      {/* Breadcrumb */}
      <div className="mb-4 flex items-center gap-2 text-sm">
        <button
          onClick={() => navigate("/fleet")}
          className="inline-flex items-center gap-1 text-[var(--accent)] hover:underline"
        >
          <ArrowLeft className="h-4 w-4" /> My Fleet
        </button>
        <span className="text-white/30">/</span>
        <span className="font-medium text-white/80">{data.pledgeName}</span>
      </div>

      {/* Header card */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/5 p-5">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-white">{data.pledgeName}</h1>
          <p className="mt-0.5 text-sm text-white/50">
            {PLEDGE_TYPE_LABELS[data.pledgeType] ?? data.pledgeType} · {data.shipsCount}{" "}
            vaisseaux inclus
            {data.createdDate ? ` · acquis le ${data.createdDate}` : ""}
            {data.isUpgraded === 1 ? " · upgradé (CCU)" : ""}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs uppercase tracking-wider text-white/40">Valeur</p>
          <p className="text-xl font-bold text-[var(--accent)]">{formatUsd(data.currentValueUsd)}</p>
        </div>
      </div>

      {/* Stats */}
      <div className="mb-5 flex flex-wrap gap-6 rounded-2xl border border-white/10 bg-white/5 px-5 py-4">
        <Stat label="Vaisseaux" value={String(data.shipsCount)} />
        <Stat label="Vaisseaux LTI" value={String(data.ltiShipsCount)} accent />
        <Stat label="Fabricants" value={String(data.manufacturersCount)} />
        <Stat label="Valeur" value={formatUsd(data.currentValueUsd)} />
      </div>

      {/* Recherche */}
      <div className="relative mb-4 max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher un vaisseau…"
          className="w-full rounded-full border border-white/10 bg-white/5 py-2 pl-9 pr-4 text-sm text-white placeholder:text-white/40 focus:border-white/20 focus:outline-none"
        />
      </div>

      <p className="mb-3 text-xs uppercase tracking-wider text-white/40">
        Vaisseaux · {visibleShips.length} sur {filteredShips.length}
      </p>

      {/* Liste */}
      <div className="flex flex-col gap-2">
        {visibleShips.map((s, i) => (
          <PackShipRow
            key={s.shipId ?? `${s.shipName}-${i}`}
            ship={s}
            onDetails={() => {
              if (s.shipId != null) setDetailShip(toShipRow(s));
            }}
          />
        ))}
      </div>

      {hasMore && (
        <div className="mt-4 flex justify-center">
          <button
            onClick={() => setVisibleCount((c) => c + LOAD_MORE_BATCH)}
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white/80 transition-colors hover:bg-white/10"
          >
            Afficher plus
          </button>
        </div>
      )}

      {detailShip && (
        <ShipDetailsModal ship={detailShip} onClose={() => setDetailShip(null)} />
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-white/40">{label}</p>
      <p className={accent ? "text-xl font-bold text-[var(--accent)]" : "text-xl font-bold text-white"}>
        {value}
      </p>
    </div>
  );
}

function PackShipRow({ ship, onDetails }: { ship: PackShip; onDetails: () => void }) {
  const canNavigate = ship.shipId != null;
  const isLti = (ship.lti ?? 0) === 1;
  return (
    <div className="flex items-center gap-4 rounded-xl border border-white/10 bg-white/5 p-3">
      <div className="flex h-14 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white/5">
        {ship.imageUrl ? (
          <img src={ship.imageUrl} alt={ship.shipName} className="h-full w-full object-cover" />
        ) : (
          <span className="text-[10px] text-white/30">Pas d'image</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <h4 className="truncate font-medium text-white">{ship.shipName}</h4>
        <p className="truncate text-sm text-white/40">{ship.manufacturer}</p>
      </div>
      {isLti && (
        <span className="shrink-0 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
          LTI
        </span>
      )}
      <button
        onClick={onDetails}
        disabled={!canNavigate}
        className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white/80 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Détails
      </button>
    </div>
  );
}
