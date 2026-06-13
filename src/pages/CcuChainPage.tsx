import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { Loader2, X } from "lucide-react";
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
  const [picker, setPicker] = useState<"from" | "to" | null>(null);

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

          {/* Panneaux DÉPART / CIBLE */}
          <ShipSelectorPair
            from={fromShip}
            to={toShip}
            onChangeFrom={() => setPicker("from")}
            onChangeTo={() => setPicker("to")}
          />

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

function Header() {
  return (
    <header>
      <p className="text-xs uppercase tracking-[0.18em] text-white/40">Upgrade Planner</p>
      <h1 className="text-2xl font-bold text-white">CCU CHAIN</h1>
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
