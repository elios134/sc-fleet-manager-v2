import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { Loader2, PackageSearch, ArrowRight, Truck } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

/* ── Types (miroir des structs Rust, camelCase serde) ── */
type FleetShip = {
  name: string;
  manufacturer: string | null;
  cargoScu: number | null;
  role: string | null;
};
type CargoRoute = {
  commodity: string;
  fromLocation: string;
  toLocation: string;
  fromName: string | null;
  toName: string | null;
  buyPrice: number;
  sellPrice: number;
  marginUnit: number;
  quantityScu: number;
  profit: number;
  fromSystem: string | null;
  toSystem: string | null;
  jumps: number | null;
  distanceGm: number | null;
  timeMinutes: number | null;
  profitPerMinute: number | null;
  fuel: number | null;
};
type FindRoutesResult = {
  shipName: string;
  cargoScu: number | null;
  qtResolved: boolean;
  investment: number;
  routesConsidered: number;
  routesWithTime: number;
  routes: CargoRoute[];
  note: string;
};
type PricesStatus = {
  rows: number;
  locationsCovered: number;
  freshestTimestamp: string | null;
};

const SYSTEMS = ["stanton", "pyro", "nyx"] as const;

/* ── Helpers ── */
function fmt(n: number): string {
  return Math.round(n).toLocaleString("fr-FR");
}
function relativeAge(iso: string | null, t: TFunction): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const mins = Math.max(0, Math.floor((Date.now() - then) / 60000));
  if (mins < 60) return t("cargo.ageMinutes", { n: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 48) return t("cargo.ageHours", { n: hours });
  return t("cargo.ageDays", { n: Math.floor(hours / 24) });
}

export default function CargoRoutesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [ships, setShips] = useState<FleetShip[]>([]);
  const [prices, setPrices] = useState<PricesStatus | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(true);

  const [shipName, setShipName] = useState<string>("");
  const [budget, setBudget] = useState<string>("1000000");
  const [system, setSystem] = useState<string>("");

  const [calculating, setCalculating] = useState(false);
  const [result, setResult] = useState<FindRoutesResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Chargement initial : flotte + état du cache de prix.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [fleet, status] = await Promise.all([
          invoke<FleetShip[]>("get_cargo_fleet_ships"),
          invoke<PricesStatus>("get_cargo_prices_status"),
        ]);
        if (!alive) return;
        setShips(fleet);
        setPrices(status);
        if (fleet.length > 0) setShipName(fleet[0].name); // plus gros cargo en tête
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoadingMeta(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const selectedShip = useMemo(
    () => ships.find((s) => s.name === shipName) ?? null,
    [ships, shipName],
  );
  const bestProfit = result?.routes?.[0]?.profit ?? null;
  const hasPrices = (prices?.rows ?? 0) > 0;

  async function calculate() {
    setError(null);
    setResult(null);
    const investment = Number(budget);
    if (!shipName) {
      setError(t("cargo.err.noShip"));
      return;
    }
    if (!Number.isFinite(investment) || investment <= 0) {
      setError(t("cargo.err.budget"));
      return;
    }
    setCalculating(true);
    try {
      const r = await invoke<FindRoutesResult>("find_cargo_routes", {
        shipName,
        investment,
        system: system || null,
        limit: 50,
      });
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCalculating(false);
    }
  }

  return (
    <div className="p-8">
      <header className="flex items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-white/40">{t("cargo.eyebrow")}</p>
          <h1 className="text-2xl font-bold text-white">{t("cargo.title")}</h1>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-[11px] text-white/60">
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: hasPrices ? "rgb(52 211 153)" : "var(--accent)" }}
            aria-hidden="true"
          />
          <span>
            {hasPrices
              ? t("cargo.pricesFresh", { age: relativeAge(prices?.freshestTimestamp ?? null, t) })
              : t("cargo.pricesNone")}
          </span>
        </div>
      </header>

      {/* Récapitulatif */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label={t("cargo.statShip")}>
          <div className="text-lg font-semibold text-white">{selectedShip?.name ?? "—"}</div>
          <div className="text-xs text-white/50">
            {selectedShip?.manufacturer ?? ""}
            {selectedShip?.role ? ` · ${selectedShip.role}` : ""}
          </div>
        </StatCard>
        <StatCard label={t("cargo.statCapacity")}>
          <div className="text-lg font-semibold text-[var(--accent)]">
            {selectedShip?.cargoScu != null ? `${fmt(selectedShip.cargoScu)} SCU` : "—"}
          </div>
          <div className="text-xs text-white/50">
            {result?.qtResolved === false ? t("cargo.qtUnresolved") : ""}
          </div>
        </StatCard>
        <StatCard label={t("cargo.statBestProfit")}>
          <div className="text-lg font-semibold text-emerald-400">
            {bestProfit != null ? `${fmt(bestProfit)} aUEC` : "—"}
          </div>
          <div className="text-xs text-white/50">
            {result ? t("cargo.routesCount", { n: result.routes.length }) : ""}
          </div>
        </StatCard>
      </div>

      {error && (
        <p className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[340px_1fr]">
        {/* Formulaire */}
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.12em] text-white/50">
            {t("cargo.form.title")}
          </p>

          {loadingMeta ? (
            <div className="flex items-center gap-2 text-sm text-white/50">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("cargo.loading")}
            </div>
          ) : ships.length === 0 ? (
            <p className="text-sm text-white/50">{t("cargo.empty.noShips")}</p>
          ) : (
            <>
              <Field label={t("cargo.form.ship")}>
                <select
                  value={shipName}
                  onChange={(e) => setShipName(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none"
                >
                  {ships.map((s) => (
                    <option key={s.name} value={s.name} className="bg-[#14141c]">
                      {s.name}
                      {s.cargoScu != null ? ` · ${s.cargoScu} SCU` : ""}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label={t("cargo.form.budget")}>
                <input
                  type="number"
                  min={0}
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none"
                />
              </Field>

              <Field label={t("cargo.form.system")}>
                <select
                  value={system}
                  onChange={(e) => setSystem(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none"
                >
                  <option value="" className="bg-[#14141c]">
                    {t("cargo.form.systemAll")}
                  </option>
                  {SYSTEMS.map((s) => (
                    <option key={s} value={s} className="bg-[#14141c]">
                      {s.charAt(0).toUpperCase() + s.slice(1)}
                    </option>
                  ))}
                </select>
              </Field>

              <button
                type="button"
                onClick={() => void calculate()}
                disabled={calculating || !hasPrices}
                className="mt-1 flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {calculating ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageSearch className="h-4 w-4" />}
                {calculating ? t("cargo.form.calculating") : t("cargo.form.calculate")}
              </button>

              {!hasPrices && (
                <button
                  type="button"
                  onClick={() => navigate("/settings")}
                  className="mt-3 w-full rounded-lg border border-[var(--accent)]/50 px-3 py-2 text-xs text-[var(--accent)] hover:bg-white/5"
                >
                  {t("cargo.empty.noPricesCta")}
                </button>
              )}

              <p className="mt-4 border-t border-white/10 pt-3 text-[11px] leading-relaxed text-white/40">
                {hasPrices
                  ? t("cargo.priceFooter", {
                      rows: fmt(prices?.rows ?? 0),
                      locs: prices?.locationsCovered ?? 0,
                      age: relativeAge(prices?.freshestTimestamp ?? null, t),
                    })
                  : t("cargo.empty.noPrices")}
              </p>
            </>
          )}
        </div>

        {/* Résultats */}
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.12em] text-white/50">
            {t("cargo.results.title")}
          </p>

          {!result ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-white/40">
              <Truck className="h-8 w-8 opacity-40" />
              <p className="text-sm">{t("cargo.results.empty")}</p>
            </div>
          ) : result.routes.length === 0 ? (
            <p className="py-12 text-center text-sm text-white/50">{t("cargo.results.none")}</p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {result.routes.map((r, i) => (
                <RouteRow key={i} r={r} rank={i + 1} t={t} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Sous-composants ── */
function StatCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="text-[11px] uppercase tracking-[0.1em] text-white/40">{label}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="mb-1 text-[11px] text-white/40">{label}</div>
      {children}
    </div>
  );
}

function RouteRow({ r, rank, t }: { r: CargoRoute; rank: number; t: TFunction }) {
  const from = r.fromName ?? r.fromLocation;
  const to = r.toName ?? r.toLocation;
  const dash = "—";
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-[11px] font-semibold text-white/30">#{rank}</span>
          <span className="truncate text-sm font-semibold capitalize text-white">{r.commodity}</span>
        </div>
        <div className="text-right">
          <div className="text-sm font-semibold text-emerald-400">+{fmt(r.profit)} aUEC</div>
          <div className="text-[11px] text-[var(--accent)]">
            {r.profitPerMinute != null ? `${fmt(r.profitPerMinute)} ${t("cargo.unit.perMin")}` : t("cargo.results.noTime")}
          </div>
        </div>
      </div>

      <div className="mt-1.5 flex items-center gap-1.5 text-[13px] text-white/70">
        <span className="truncate capitalize">{from}</span>
        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-white/30" />
        <span className="truncate capitalize">{to}</span>
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-white/50">
        <span>
          {t("cargo.results.buy")} <span className="text-white/70">{fmt(r.buyPrice)}</span>
        </span>
        <span>
          {t("cargo.results.sell")} <span className="text-white/70">{fmt(r.sellPrice)}</span>
        </span>
        <span>
          {t("cargo.results.margin")} <span className="text-white/70">{fmt(r.marginUnit)}</span>
        </span>
        <span>
          {t("cargo.results.qty")} <span className="text-white/70">{fmt(r.quantityScu)} SCU</span>
        </span>
        <span>
          {t("cargo.results.distance")}{" "}
          <span className="text-white/70">{r.distanceGm != null ? `${r.distanceGm.toFixed(2)} Gm` : dash}</span>
        </span>
        <span>
          {t("cargo.results.time")}{" "}
          <span className="text-white/70">
            {r.timeMinutes != null ? `${r.timeMinutes.toFixed(1)} ${t("cargo.unit.min")}` : dash}
          </span>
        </span>
      </div>
    </div>
  );
}
