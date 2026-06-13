import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { Loader2, X } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { refreshStarjumpManifest, resolveShipTopDownUrl } from "../lib/starjump";

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
  isOwnedSourceShip: boolean;
};

type CcuPath = {
  steps: Step[];
  totalCostCents: number;
  stepCount: number;
  directCostCents: number | null;
  savingCents: number | null;
  warbondEndIndex: number | null;
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

/** Delta signé, ex. « +$23 » / « -$73 ». */
function fmtMoneyDelta(cents: number): string {
  const sign = cents < 0 ? "-" : "+";
  return `${sign}${fmtMoney(Math.abs(cents))}`;
}

/** Pourcentage d'une référence, ex. (-7300, 76000) → « -9.6% ». Référence nulle → « ». */
function fmtPct(part: number, whole: number | null): string {
  if (whole === null || whole === 0) return "";
  const rounded = Math.round((part / whole) * 1000) / 10;
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// lastSyncAt = datetime('now') SQLite (UTC, « YYYY-MM-DD HH:MM:SS ») → parser en UTC.
function parseSyncMs(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso.replace(" ", "T") + "Z").getTime();
  return Number.isNaN(t) ? null : t;
}

/** Âge relatif : « jamais » / « à l'instant » / « il y a {n} min/h/j ». */
function relativeAge(iso: string | null): string {
  const t = parseSyncMs(iso);
  if (t === null) return "jamais";
  const mins = Math.floor((Date.now() - t) / 60000);
  if (mins < 1) return "à l'instant";
  if (mins < 60) return `il y a ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `il y a ${hours} h`;
  return `il y a ${Math.floor(hours / 24)} j`;
}

export default function CcuChainPage() {
  const navigate = useNavigate();
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
  const [picker, setPicker] = useState<"from" | "to" | null>(null);
  const [sortMode, setSortMode] = useState<"cost" | "saving">("cost");
  const [expanded, setExpanded] = useState<Set<number>>(new Set([0]));

  const shipsById = useMemo(() => {
    const map = new Map<number, CcuShip>();
    for (const s of ships) map.set(s.shipId, s);
    return map;
  }, [ships]);

  // ── Mount : statut catalogue → métadonnées → pré-sélection FROM ──
  useEffect(() => {
    let cancelled = false;
    void refreshStarjumpManifest(); // best-effort : top-down du manifeste réseau si dispo
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
          setExpanded(new Set([0])); // re-déplie la meilleure chaîne à chaque recherche
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

  const fromShip = fromShipId !== null ? (shipsById.get(fromShipId) ?? null) : null;
  const toShip = toShipId !== null ? (shipsById.get(toShipId) ?? null) : null;
  const bothSelected = fromShipId !== null && toShipId !== null && fromShipId !== toShipId;
  const sameShip = fromShipId !== null && toShipId !== null && fromShipId === toShipId;
  const lastSyncAt = catalogStatus?.lastSyncAt ?? null;
  const syncMs = parseSyncMs(lastSyncAt);
  const isStale = syncMs !== null && Date.now() - syncMs > SEVEN_DAYS_MS;

  // Tri d'affichage. On garde l'index d'origine (chaîne la moins chère = #0 = BEST) pour
  // ancrer le badge BEST et l'état déplié, qui ne suivent donc pas le re-tri.
  const sortedPaths = useMemo(() => {
    if (!result) return [];
    const indexed = result.paths.map((p, i) => ({ p, originalIndex: i }));
    if (sortMode === "saving") {
      indexed.sort((a, b) => (b.p.savingCents ?? -Infinity) - (a.p.savingCents ?? -Infinity));
    } else {
      indexed.sort(
        (a, b) => a.p.totalCostCents - b.p.totalCostCents || a.p.stepCount - b.p.stepCount,
      );
    }
    return indexed;
  }, [result, sortMode]);

  function toggleExpand(originalIndex: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(originalIndex)) next.delete(originalIndex);
      else next.add(originalIndex);
      return next;
    });
  }

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
      <Header
        right={
          phase === "ready" ? (
            <div className="flex items-center gap-2.5">
              <div className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-[11px] text-white/60">
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: isStale ? "var(--accent)" : "rgb(52 211 153)" }}
                  aria-hidden="true"
                />
                <span>{isStale ? "Catalogue à resync" : "Catalogue à jour"}</span>
                <span className="text-white/30">· {relativeAge(lastSyncAt)}</span>
              </div>
              <button
                type="button"
                onClick={() => navigate("/settings")}
                className="rounded-lg border border-[var(--accent)] px-3 py-2 text-[11px] uppercase tracking-wider text-[var(--accent)] transition-colors hover:bg-white/5"
              >
                ↻ Resync
              </button>
            </div>
          ) : undefined
        }
      />

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

          {/* Panneaux DÉPART / CIBLE */}
          <ShipSelectorPair
            from={fromShip}
            to={toShip}
            onChangeFrom={() => setPicker("from")}
            onChangeTo={() => setPicker("to")}
          />

          {sameShip && (
            <div className="mt-4 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-300">
              Choisis deux vaisseaux différents.
            </div>
          )}

          {isStale && (
            <div
              className="mt-4 rounded-xl px-4 py-2 text-xs text-[var(--accent)]"
              style={{ border: "1px solid color-mix(in oklab, var(--accent) 35%, rgba(255,255,255,0.12))" }}
            >
              Le catalogue a plus de 7 jours — pense à le resync pour des prix exacts.
            </div>
          )}

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

                <div className="mb-3 mt-5 flex items-baseline justify-between gap-3">
                  <div className="text-[10px] uppercase tracking-[0.2em] text-white/40">
                    <span className="font-semibold text-[var(--accent)]">{result.totalFound}</span>{" "}
                    chemins disponibles · triés par {sortMode === "cost" ? "coût" : "économie"}
                  </div>
                  <div className="flex gap-1">
                    <SortButton active={sortMode === "cost"} onClick={() => setSortMode("cost")}>
                      Coût ↑
                    </SortButton>
                    <SortButton active={sortMode === "saving"} onClick={() => setSortMode("saving")}>
                      Économie ↓
                    </SortButton>
                  </div>
                </div>

                <div className="flex flex-col gap-2.5">
                  {sortedPaths.map(({ p, originalIndex }, displayIdx) => (
                    <PathCard
                      key={originalIndex}
                      path={p}
                      rank={displayIdx + 1}
                      isBest={originalIndex === 0}
                      expanded={expanded.has(originalIndex)}
                      onToggle={() => toggleExpand(originalIndex)}
                      shipsById={shipsById}
                    />
                  ))}
                </div>
              </>
            )}
          </section>

          {picker && (
            <ShipPickerModal
              ships={ships}
              mode={picker}
              onPick={(id) => {
                if (picker === "from") setFromShipId(id);
                else setToShipId(id);
                setPicker(null);
              }}
              onClose={() => setPicker(null)}
            />
          )}
        </>
      )}
    </div>
  );
}

function Header({ right }: { right?: ReactNode }) {
  return (
    <header className="flex items-end justify-between gap-3">
      <div>
        <p className="text-xs uppercase tracking-[0.18em] text-white/40">Upgrade Planner</p>
        <h1 className="text-2xl font-bold text-white">CCU CHAIN</h1>
      </div>
      {right}
    </header>
  );
}

/* ── Panneaux DÉPART / CIBLE (calqués V1 ShipSelectorPair, adaptés tokens V2) ── */

// Vignette top-down Starjump (même mécanisme que Loadout/Comparateur) en bannière large.
// Résolue depuis le NOM ; onError ou non-résoluble → fallback glyphe ⌬ (jamais l'image 3/4).
function PanelTopDown({ name }: { name: string }) {
  const url = resolveShipTopDownUrl(name);
  const [src, setSrc] = useState<string | null>(url);
  useEffect(() => {
    setSrc(url);
  }, [url]);
  return (
    <div
      className="relative mx-auto mt-3 flex items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-black/30"
      style={{ aspectRatio: "2.5 / 1", width: "70%" }}
    >
      {src ? (
        <img
          src={src}
          alt={`${name} vue de dessus`}
          onError={() => setSrc(null)}
          className="pointer-events-none relative z-10 max-h-[88%] max-w-[92%] select-none object-contain"
        />
      ) : (
        <div className="grid h-full w-full place-items-center text-4xl text-white/25">⌬</div>
      )}
    </div>
  );
}

function ShipPanel({
  ship,
  label,
  onChange,
}: {
  ship: CcuShip | null;
  label: string;
  onChange: () => void;
}) {
  return (
    <div className="relative rounded-2xl border border-white/10 bg-white/5 p-5">
      <div className="text-[10px] uppercase tracking-[0.3em] text-white/40">{label}</div>
      <button
        type="button"
        onClick={onChange}
        className="absolute right-3 top-3 z-10 rounded-lg border border-white/10 px-2 py-1 text-[10px] uppercase tracking-wider text-white/50 transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
      >
        Changer
      </button>

      {ship ? (
        <>
          <PanelTopDown name={ship.name} />
          <div className="mt-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base font-semibold text-white">{ship.name}</span>
              {ship.isOwned && (
                <span className="rounded border border-emerald-400/60 px-1.5 py-px text-[9px] uppercase tracking-wider text-emerald-400">
                  Possédé
                </span>
              )}
            </div>
            <div className="mt-0.5 text-[11px] text-white/40">
              {ship.manufacturer ?? "—"}
              {ship.focus ? ` · ${ship.focus}` : ""}
            </div>
            <div className="mt-1.5 text-sm font-semibold text-[var(--accent)]">
              {ship.priceCents != null ? (
                <>
                  {fmtMoney(ship.priceCents)}
                  {ship.priceSource === "msrp" && (
                    <span className="ml-1 text-[9px] font-normal text-white/40">MSRP</span>
                  )}
                </>
              ) : (
                "—"
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="py-3 text-sm italic text-white/40">Aucun vaisseau sélectionné</div>
      )}
    </div>
  );
}

function ShipSelectorPair({
  from,
  to,
  onChangeFrom,
  onChangeTo,
}: {
  from: CcuShip | null;
  to: CcuShip | null;
  onChangeFrom: () => void;
  onChangeTo: () => void;
}) {
  return (
    <section
      className="mt-6 grid items-stretch gap-3"
      style={{ gridTemplateColumns: "1fr 48px 1fr" }}
    >
      <ShipPanel ship={from} label="Départ" onChange={onChangeFrom} />
      <div className="grid place-items-center" aria-hidden="true">
        <svg width="32" height="20" viewBox="0 0 32 20" fill="none" stroke="var(--accent)" strokeWidth="2">
          <path d="M2 10 L26 10 M20 4 L26 10 L20 16" />
        </svg>
      </div>
      <ShipPanel ship={to} label="Cible" onChange={onChangeTo} />
    </section>
  );
}

/* ── Modale de sélection (calquée V1 ShipPickerModal, adaptée tokens V2) ── */

function PickerChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border px-3 py-1.5 text-[10px] uppercase tracking-wide transition-colors"
      style={{
        borderColor: active ? "var(--accent)" : "rgba(255,255,255,0.1)",
        background: active ? "color-mix(in oklab, var(--accent) 14%, transparent)" : "transparent",
        color: active ? "var(--accent)" : "rgba(255,255,255,0.7)",
      }}
    >
      {children}
    </button>
  );
}

function ShipPickerModal({
  ships,
  mode,
  onPick,
  onClose,
}: {
  ships: CcuShip[];
  mode: "from" | "to";
  onPick: (shipId: number) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [ownedOnly, setOwnedOnly] = useState(false);
  const [availableOnly, setAvailableOnly] = useState(false);
  const [manufacturer, setManufacturer] = useState("ALL");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Masque les vaisseaux au nom non résolu (« Ship #id »), dans la modale seulement.
  // Côté CIBLE : n'affiche que les vaisseaux réellement achetables en CCU (au moins un
  // SKU → priceSource === "ccu"). Côté DÉPART : on garde tout (sources incluses).
  const base = useMemo(
    () =>
      ships.filter((s) => {
        if (/^Ship #\d+$/.test(s.name)) return false;
        if (mode === "to" && s.priceSource !== "ccu") return false;
        return true;
      }),
    [ships, mode],
  );

  const manufacturers = useMemo(() => {
    const set = new Set<string>();
    for (const s of base) if (s.manufacturer) set.add(s.manufacturer);
    return ["ALL", ...[...set].sort((a, b) => a.localeCompare(b))];
  }, [base]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return base.filter((s) => {
      if (ownedOnly && !s.isOwned) return false;
      if (availableOnly && !s.isAvailable) return false;
      if (manufacturer !== "ALL" && s.manufacturer !== manufacturer) return false;
      if (
        q &&
        !(
          s.name.toLowerCase().includes(q) ||
          (s.manufacturer ?? "").toLowerCase().includes(q) ||
          (s.focus ?? "").toLowerCase().includes(q)
        )
      )
        return false;
      return true;
    });
  }, [base, query, ownedOnly, availableOnly, manufacturer]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" onMouseDown={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="relative z-10 flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border backdrop-blur-2xl"
        style={{ background: "rgba(20,20,28,0.95)", borderColor: "var(--card-border)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <span className="text-sm font-semibold uppercase tracking-wider text-[var(--accent)]">
            {mode === "from" ? "Départ" : "Cible"}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="rounded-lg p-1 text-white/60 hover:bg-white/10"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Recherche + filtres */}
        <div className="flex flex-col gap-2 border-b border-white/10 px-5 py-3">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher un vaisseau…"
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-white/20"
          />
          <div className="flex flex-wrap items-center gap-2">
            <PickerChip active={ownedOnly} onClick={() => setOwnedOnly((v) => !v)}>
              Possédés uniquement
            </PickerChip>
            <PickerChip active={availableOnly} onClick={() => setAvailableOnly((v) => !v)}>
              Disponible uniquement
            </PickerChip>
            <select
              value={manufacturer}
              onChange={(e) => setManufacturer(e.target.value)}
              className="rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-xs text-white/80 outline-none"
            >
              {manufacturers.map((m) => (
                <option key={m} value={m} className="bg-[#14141c]">
                  {m === "ALL" ? "Tous les constructeurs" : m}
                </option>
              ))}
            </select>
            <span className="ml-auto text-[10px] text-white/40">{filtered.length} vaisseaux</span>
          </div>
        </div>

        {/* Liste */}
        <div className="overflow-y-auto py-1.5">
          {filtered.length === 0 ? (
            <div className="py-8 text-center text-sm text-white/40">Aucun vaisseau ne correspond.</div>
          ) : (
            filtered.map((s) => (
              <button
                key={s.shipId}
                type="button"
                onClick={() => onPick(s.shipId)}
                className="flex w-full items-center gap-3 px-5 py-2 text-left transition-colors hover:bg-white/5"
              >
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium text-white">{s.name}</span>
                  {s.isOwned && (
                    <span className="ml-2 rounded border border-emerald-400/60 px-1 py-px text-[9px] uppercase tracking-wider text-emerald-400">
                      Possédé
                    </span>
                  )}
                  <div className="mt-0.5 text-[10px] text-white/40">
                    {s.manufacturer ?? "—"}
                    {s.focus ? ` · ${s.focus}` : ""}
                  </div>
                </div>
                <span className="shrink-0 text-sm font-semibold text-[var(--accent)]">
                  {s.priceCents != null ? (
                    <>
                      {fmtMoney(s.priceCents)}
                      {s.priceSource === "msrp" && (
                        <span className="ml-1 text-[9px] font-normal text-white/40">MSRP</span>
                      )}
                    </>
                  ) : (
                    "—"
                  )}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ── Ligne de stats (4 colonnes, calquée V1 StatsRow) ── */

function StatsRow({ result }: { result: FindPathsResult }) {
  const minCost = result.paths.length > 0 ? result.paths[0]!.totalCostCents : null;
  const saving = result.bestSavingCents;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Stat label="Chemins trouvés">
        <span className="text-[var(--accent)]">{result.totalFound}</span>
        <span className="ml-1 text-xs font-normal text-white/40">routes</span>
      </Stat>
      <Stat label="Coût min">
        {minCost != null ? (
          <span className="text-[var(--accent)]">{fmtMoney(minCost)}</span>
        ) : (
          <span className="text-white/30">—</span>
        )}
      </Stat>
      <Stat label="Achat direct">
        {result.directCostCents != null ? (
          fmtMoney(result.directCostCents)
        ) : (
          <span className="text-white/30">—</span>
        )}
      </Stat>
      <Stat label="Économie max">
        {saving != null && saving > 0 ? (
          <span className="text-emerald-400">
            {fmtMoney(saving)}
            <span className="ml-1 text-xs font-normal text-white/40">
              {fmtPct(-saving, result.directCostCents)}
            </span>
          </span>
        ) : (
          <span className="text-white/30">—</span>
        )}
      </Stat>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
      <p className="text-[10px] uppercase tracking-wider text-white/40">{label}</p>
      <p className="mt-1 text-lg font-semibold text-white">{children}</p>
    </div>
  );
}

function SortButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border px-2.5 py-1 text-[10px] uppercase tracking-wider transition-colors"
      style={{
        borderColor: active ? "var(--accent)" : "rgba(255,255,255,0.1)",
        color: active ? "var(--accent)" : "rgba(255,255,255,0.5)",
      }}
    >
      {children}
    </button>
  );
}

/* ── Carte de résultat dépliable (calquée V1 PathCard) ── */

function shipName(shipsById: Map<number, CcuShip>, id: number): string {
  return shipsById.get(id)?.name ?? `Ship #${id}`;
}

type WarbondTag = "warbond" | "standard" | "none";

// Flux horizontal illustré (boîtes DÉPART / ÉTAPE n / CIBLE + liens +$delta). Pas de
// vignette top-down dans les boîtes (fidélité V1 — seuls les panneaux 3a en ont).
function ChainFlow({
  path,
  shipsById,
}: {
  path: CcuPath;
  shipsById: Map<number, CcuShip>;
}) {
  if (path.steps.length === 0) return null;
  const startId = path.steps[0]!.fromShipId;

  const node = (
    shipId: number,
    kind: "start" | "step" | "target",
    stepIdx: number,
    owned: boolean,
    warbondTag: WarbondTag,
  ) => {
    const meta = shipsById.get(shipId);
    const borderColor =
      kind === "target" ? "var(--accent)" : owned ? "rgb(52 211 153 / 0.7)" : "rgba(255,255,255,0.1)";
    const label =
      kind === "start"
        ? `Départ · ${meta?.manufacturer ?? "—"}`
        : kind === "target"
          ? `Cible · ${meta?.manufacturer ?? "—"}`
          : `Étape ${stepIdx} · ${meta?.manufacturer ?? "—"}`;
    return (
      <div
        className="relative shrink-0 rounded-lg bg-black/20 p-3"
        style={{ minWidth: 160, border: `1px solid ${borderColor}` }}
      >
        <div className="absolute -top-2 right-1.5 flex flex-col items-end gap-1">
          {kind === "target" && (
            <span className="rounded-sm bg-[var(--accent)] px-1.5 py-px text-[8px] font-bold uppercase tracking-wider text-black">
              ★ Cible
            </span>
          )}
          {kind === "step" && owned && (
            <span className="rounded-sm bg-emerald-400 px-1.5 py-px text-[8px] font-bold uppercase tracking-wider text-black">
              ✓ Possédé
            </span>
          )}
          {warbondTag === "warbond" && (
            <span className="rounded-sm border border-[var(--accent)] px-1.5 py-px text-[8px] font-bold uppercase tracking-wider text-[var(--accent)]">
              Warbond
            </span>
          )}
          {warbondTag === "standard" && (
            <span className="rounded-sm border border-white/30 px-1.5 py-px text-[8px] font-bold uppercase tracking-wider text-white/40">
              Standard
            </span>
          )}
        </div>
        <div className="text-[9px] uppercase tracking-wider text-white/40">{label}</div>
        <div className="mt-1 text-[13px] font-semibold text-white">{shipName(shipsById, shipId)}</div>
        {meta && (
          <div className="mt-1 text-[11px] text-white/40">
            valeur{" "}
            <span className="font-semibold text-[var(--accent)]">
              {meta.priceCents != null ? (
                <>
                  {fmtMoney(meta.priceCents)}
                  {meta.priceSource === "msrp" && (
                    <span className="ml-1 font-normal text-white/40">MSRP</span>
                  )}
                </>
              ) : (
                "—"
              )}
            </span>
          </div>
        )}
      </div>
    );
  };

  const link = (cents: number) => (
    <div className="flex shrink-0 flex-col items-center justify-center px-3" style={{ minWidth: 84 }}>
      <div className="text-lg leading-none text-[var(--accent)]">→</div>
      <div className="mt-1 text-[13px] font-bold text-[var(--accent)]">{fmtMoneyDelta(cents)}</div>
    </div>
  );

  return (
    <div className="flex items-stretch overflow-x-auto py-2">
      {node(startId, "start", 0, path.steps[0]!.isOwnedSourceShip, "none")}
      {path.steps.map((step, i) => {
        const isLast = i === path.steps.length - 1;
        const warbondTag: WarbondTag =
          path.warbondEndIndex === null ? "none" : i <= path.warbondEndIndex ? "warbond" : "standard";
        const nextOwned = isLast ? false : path.steps[i + 1]!.isOwnedSourceShip;
        return (
          <div key={step.toSkuId} className="flex items-stretch">
            {link(step.upgradePriceCents)}
            {node(step.toShipId, isLast ? "target" : "step", i + 1, nextOwned, warbondTag)}
          </div>
        );
      })}
    </div>
  );
}

function PathCard({
  path,
  rank,
  isBest,
  expanded,
  onToggle,
  shipsById,
}: {
  path: CcuPath;
  rank: number;
  isBest: boolean;
  expanded: boolean;
  onToggle: () => void;
  shipsById: Map<number, CcuShip>;
}) {
  const startId = path.steps[0]?.fromShipId;
  const positiveSaving = path.savingCents != null && path.savingCents > 0;
  const [copied, setCopied] = useState(false);

  function openRsi() {
    void openUrl("https://robertsspaceindustries.com/en/account/pledges");
  }

  function copyPlan() {
    const start = startId !== undefined ? shipName(shipsById, startId) : "?";
    const hops = path.steps
      .map((s) => `${shipName(shipsById, s.toShipId)} (${fmtMoneyDelta(s.upgradePriceCents)})`)
      .join(" → ");
    const text = `${start} → ${hops} | TOTAL: ${fmtMoney(path.totalCostCents)}`;
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div
      className="relative overflow-hidden rounded-2xl bg-white/5"
      style={{ border: `1px solid ${expanded || isBest ? "var(--accent)" : "rgba(255,255,255,0.1)"}` }}
    >
      {isBest && (
        <span className="absolute left-0 top-0 z-10 rounded-br-lg bg-[var(--accent)] px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-black">
          Best
        </span>
      )}

      <button
        type="button"
        onClick={onToggle}
        className="grid w-full items-center gap-4 px-4 py-3.5 text-left"
        style={{ gridTemplateColumns: "auto 1fr auto auto auto" }}
      >
        <span
          className="w-7 text-lg font-bold"
          style={{ color: isBest ? "var(--accent)" : "rgba(255,255,255,0.4)", paddingLeft: isBest ? 6 : 0 }}
        >
          #{rank}
        </span>

        <span className="flex min-w-0 flex-wrap items-center gap-2">
          {startId !== undefined && (
            <span
              className="text-xs font-medium"
              style={{ color: path.steps[0]!.isOwnedSourceShip ? "rgb(52 211 153)" : "white" }}
            >
              {shipName(shipsById, startId)}
            </span>
          )}
          {path.steps.map((step, i) => {
            const inStandard = path.warbondEndIndex !== null && i > path.warbondEndIndex;
            return (
              <span key={step.toSkuId} className="flex items-center gap-2">
                <span className="text-[10px] text-white/40">
                  <span className="font-semibold text-[var(--accent)]">
                    {fmtMoneyDelta(step.upgradePriceCents)}
                  </span>{" "}
                  →
                </span>
                <span
                  className="text-xs font-medium"
                  style={{
                    color: inStandard ? "rgba(255,255,255,0.4)" : "white",
                    fontStyle: inStandard ? "italic" : "normal",
                  }}
                >
                  {shipName(shipsById, step.toShipId)}
                </span>
              </span>
            );
          })}
        </span>

        <span className="text-right">
          <div className="text-[9px] uppercase tracking-[0.2em] text-white/40">Total</div>
          <div className="text-base font-bold text-[var(--accent)]">{fmtMoney(path.totalCostCents)}</div>
        </span>

        <span className="text-right" style={{ minWidth: 64 }}>
          <div className="text-[9px] uppercase tracking-[0.2em] text-white/40">Économie</div>
          {positiveSaving ? (
            <div className="text-sm font-semibold text-emerald-400">
              -{fmtMoney(path.savingCents!)}
              <span className="ml-1 text-[10px] text-white/40">
                {fmtPct(-path.savingCents!, path.directCostCents)}
              </span>
            </div>
          ) : (
            <div className="text-xs text-white/40">référence</div>
          )}
        </span>

        <span
          className="text-sm transition-transform"
          style={{
            color: expanded ? "var(--accent)" : "rgba(255,255,255,0.4)",
            transform: expanded ? "rotate(180deg)" : "none",
          }}
        >
          ▾
        </span>
      </button>

      {expanded && (
        <div className="border-t border-white/10 bg-black/20 px-5 py-4">
          <ChainFlow path={path} shipsById={shipsById} />
          <div className="mt-4 flex gap-2.5 border-t border-white/10 pt-4">
            <button
              type="button"
              onClick={openRsi}
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-black transition-opacity hover:opacity-90"
            >
              ↗ Ouvrir sur RSI
            </button>
            <button
              type="button"
              onClick={copyPlan}
              className="rounded-lg border border-white/10 px-4 py-2 text-[11px] uppercase tracking-wider text-white/70 transition-colors hover:bg-white/5"
            >
              {copied ? "✓ Copié" : "⎘ Copier le plan"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
