import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { ArrowLeftRight, Loader2 } from "lucide-react";

type CcuShip = {
  shipId: number;
  name: string;
  manufacturer: string | null;
  focus: string | null;
  imageUrl: string | null;
  priceCents: number | null;
  priceSource: "ccu" | "msrp" | null;
  isOwned: boolean;
  isAvailable: boolean;
};

type Step = {
  fromShipId: number;
  toShipId: number;
  toSkuId: number;
  toSkuPriceCents: number;
  upgradePriceCents: number;
};

type CcuPath = {
  steps: Step[];
  totalCostCents: number;
  stepCount: number;
  directCostCents: number | null;
  savingCents: number | null;
};

type FindPathsResult = {
  paths: CcuPath[];
  totalFound: number;
  directCostCents: number | null;
  bestSavingCents: number | null;
  truncated: boolean;
};

type CatalogStatus = {
  hasSkus: boolean;
  hasUpgrades: boolean;
  lastSyncAt: string | null;
};

type Phase = "loading" | "empty" | "ready";

function fmtMoney(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

export default function CcuChainPage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [ships, setShips] = useState<CcuShip[]>([]);
  const [fromShipId, setFromShipId] = useState<number | null>(null);
  const [toShipId, setToShipId] = useState<number | null>(null);
  const [filters, setFilters] = useState<{ onlyAvailable: boolean; maxSteps: number }>({
    onlyAvailable: true,
    maxSteps: 5,
  });
  const [result, setResult] = useState<FindPathsResult | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [catalogStatus, setCatalogStatus] = useState<CatalogStatus | null>(null);
  const [accountId, setAccountId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const shipsById = useMemo(() => {
    const map = new Map<number, CcuShip>();
    for (const s of ships) map.set(s.shipId, s);
    return map;
  }, [ships]);

  const sortedShips = useMemo(
    () => [...ships].sort((a, b) => a.name.localeCompare(b.name)),
    [ships],
  );

  // ── Mount : statut catalogue → métadonnées → pré-sélection FROM ──
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const active = await invoke<string | null>("get_active_account_id");
        const acc = active ?? "";
        if (!cancelled) setAccountId(acc);

        const status = await invoke<CatalogStatus>("get_ccu_catalog_status", { accountId: acc });
        if (cancelled) return;
        setCatalogStatus(status);
        if (!status.hasSkus || !status.hasUpgrades) {
          setPhase("empty");
          return;
        }

        const meta = await invoke<CcuShip[]>("get_ccu_ships_metadata", { accountId: acc });
        if (cancelled) return;
        setShips(meta);

        // Pré-sélectionne le vaisseau possédé au priceCents le plus bas.
        const ownedWithPrice = meta.filter((s) => s.isOwned && s.priceCents != null);
        if (ownedWithPrice.length > 0) {
          const cheapest = ownedWithPrice.reduce((a, b) =>
            (b.priceCents ?? Infinity) < (a.priceCents ?? Infinity) ? b : a,
          );
          setFromShipId(cheapest.shipId);
        }
        setPhase("ready");
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setPhase("empty");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Recherche debouncée (300 ms) ──
  useEffect(() => {
    if (phase !== "ready") return;
    if (fromShipId === null || toShipId === null || fromShipId === toShipId) {
      setResult(null);
      return;
    }
    setIsSearching(true);
    const handle = setTimeout(() => {
      void (async () => {
        try {
          const res = await invoke<FindPathsResult>("find_ccu_paths", {
            fromShipId,
            toShipId,
            maxSteps: filters.maxSteps,
            onlyAvailable: filters.onlyAvailable,
            onlyOwnedSource: false,
            topN: 30,
            accountId,
          });
          setResult(res);
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
          setResult(null);
        } finally {
          setIsSearching(false);
        }
      })();
    }, 300);
    return () => clearTimeout(handle);
  }, [phase, fromShipId, toShipId, filters, accountId]);

  function swap() {
    setFromShipId(toShipId);
    setToShipId(fromShipId);
  }

  const bothSelected = fromShipId !== null && toShipId !== null && fromShipId !== toShipId;

  if (phase === "empty") {
    return (
      <div className="p-8">
        <Header />
        <div className="mt-6 rounded-2xl border border-dashed border-white/15 bg-white/5 p-10 text-center">
          <p className="text-white/70">Catalogue CCU vide — synchronisez d'abord depuis Settings</p>
          <Link
            to="/settings"
            className="mt-4 inline-block rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            Aller dans Settings
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <Header />

      {phase === "loading" ? (
        <div className="mt-6 flex items-center gap-2 text-white/50">
          <Loader2 className="h-4 w-4 animate-spin" />
          Chargement du catalogue…
        </div>
      ) : (
        <>
          {error && (
            <p className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
              {error}
            </p>
          )}

          {catalogStatus?.lastSyncAt && (
            <p className="mt-2 text-xs text-white/30">
              Catalogue synchronisé : {catalogStatus.lastSyncAt}
            </p>
          )}

          {/* Pickers FROM / TO */}
          <section className="mt-6 flex flex-col items-stretch gap-3 sm:flex-row sm:items-end">
            <ShipSelect
              label="Depuis"
              value={fromShipId}
              ships={sortedShips}
              onChange={setFromShipId}
            />
            <button
              onClick={swap}
              title="Inverser"
              className="flex h-10 w-10 shrink-0 items-center justify-center self-center rounded-full border border-white/10 bg-white/5 text-white/70 transition-colors hover:bg-white/10 sm:self-end"
            >
              <ArrowLeftRight className="h-4 w-4" />
            </button>
            <ShipSelect label="Vers" value={toShipId} ships={sortedShips} onChange={setToShipId} />
          </section>

          {/* Filtres */}
          <section className="mt-4 flex flex-wrap items-center gap-5">
            <label className="flex items-center gap-2 text-sm text-white/70">
              <input
                type="checkbox"
                checked={filters.onlyAvailable}
                onChange={(e) => setFilters((f) => ({ ...f, onlyAvailable: e.target.checked }))}
                className="h-4 w-4 accent-[var(--accent)]"
              />
              Disponibles uniquement
            </label>
            <label className="flex items-center gap-2 text-sm text-white/70">
              Étapes
              <select
                value={filters.maxSteps}
                onChange={(e) => setFilters((f) => ({ ...f, maxSteps: Number(e.target.value) }))}
                className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-sm text-white focus:outline-none"
              >
                {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                  <option key={n} value={n} className="bg-[#14141c]">
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </section>

          {/* Résultats */}
          <section className="mt-6">
            {isSearching ? (
              <div className="flex items-center gap-2 text-white/50">
                <Loader2 className="h-4 w-4 animate-spin" />
                Recherche des chemins…
              </div>
            ) : !bothSelected ? (
              <p className="text-sm text-white/40">
                Sélectionnez un vaisseau de départ et d'arrivée.
              </p>
            ) : !result || result.paths.length === 0 ? (
              <p className="text-sm text-white/40">Aucun chemin trouvé</p>
            ) : (
              <>
                <StatsRow result={result} />
                <div className="mt-4 flex flex-col gap-3">
                  {result.paths.map((path, i) => (
                    <PathCard key={i} path={path} shipsById={shipsById} isBest={i === 0} />
                  ))}
                </div>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Header() {
  return (
    <header>
      <p className="text-xs uppercase tracking-[0.18em] text-white/40">Upgrade Planner</p>
      <h1 className="text-2xl font-bold text-white">CCU CHAIN</h1>
    </header>
  );
}

function ShipSelect({
  label,
  value,
  ships,
  onChange,
}: {
  label: string;
  value: number | null;
  ships: CcuShip[];
  onChange: (id: number) => void;
}) {
  return (
    <label className="flex flex-1 flex-col gap-1">
      <span className="text-xs uppercase tracking-wider text-white/40">{label}</span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white focus:border-white/20 focus:outline-none"
      >
        <option value="" disabled className="bg-[#14141c]">
          Sélectionner un vaisseau
        </option>
        {ships.map((s) => (
          <option key={s.shipId} value={s.shipId} className="bg-[#14141c]">
            {s.name}
            {s.isOwned ? " (possédé)" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

function StatsRow({ result }: { result: FindPathsResult }) {
  return (
    <div className="flex flex-wrap gap-6 rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm">
      <Stat label="Chemins" value={String(result.totalFound)} />
      <Stat
        label="Économie max"
        value={result.bestSavingCents != null ? fmtMoney(result.bestSavingCents) : "—"}
        accent={result.bestSavingCents != null && result.bestSavingCents > 0}
      />
      <Stat
        label="Coût direct"
        value={result.directCostCents != null ? fmtMoney(result.directCostCents) : "—"}
      />
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-white/40">{label}</p>
      <p className={accent ? "font-semibold text-emerald-400" : "font-semibold text-white"}>
        {value}
      </p>
    </div>
  );
}

function PathCard({
  path,
  shipsById,
  isBest,
}: {
  path: CcuPath;
  shipsById: Map<number, CcuShip>;
  isBest: boolean;
}) {
  const name = (id: number) => shipsById.get(id)?.name ?? `#${id}`;
  const startId = path.steps[0]?.fromShipId;
  const positiveSaving = path.savingCents != null && path.savingCents > 0;

  return (
    <article className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {isBest && (
          <span className="rounded-full bg-[var(--accent-muted)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--accent)]">
            Meilleur
          </span>
        )}
        <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-white/70">
          {path.stepCount} étape{path.stepCount > 1 ? "s" : ""}
        </span>
        {path.savingCents != null && (
          <span
            className={[
              "rounded-full px-2 py-0.5 text-[10px] font-semibold",
              positiveSaving
                ? "bg-emerald-500/15 text-emerald-400"
                : "bg-white/10 text-white/50",
            ].join(" ")}
          >
            {positiveSaving ? "−" : ""}
            {fmtMoney(Math.abs(path.savingCents))}
          </span>
        )}
      </div>

      {/* Étapes */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        {startId !== undefined && <span className="font-medium text-white">{name(startId)}</span>}
        {path.steps.map((step, i) => (
          <span key={i} className="flex items-center gap-2">
            <span className="text-white/30">→</span>
            <span className="font-medium text-white">{name(step.toShipId)}</span>
            <span className="text-xs text-white/40">({fmtMoney(step.upgradePriceCents)})</span>
          </span>
        ))}
      </div>

      <p className="mt-3 text-xl font-bold text-white">{fmtMoney(path.totalCostCents)}</p>
    </article>
  );
}
