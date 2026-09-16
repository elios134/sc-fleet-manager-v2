import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { usePersistentState } from "../../lib/uiPersist";
import { Loader2 } from "lucide-react";
import { refreshStarjumpManifest } from "../../lib/starjump";
import Dropdown from "../../components/ui/Dropdown";
import { type CcuShip, type FindPathsResult, type CatalogStatus, type Phase } from "./types";
import { displayTaxMultiplier, VAT_RATE_META_KEY } from "./helpers";
import { Header } from "./components/Header";
import { ShipSelectorPair } from "./components/ShipSelectorPair";
import { ShipPickerModal } from "./components/ShipPickerModal";
import { StatsRow } from "./components/StatsRow";
import { SortButton } from "./components/SortButton";
import { PathCard } from "./components/PathCard";

export default function CcuChainPage() {
  const { t } = useTranslation();
  const location = useLocation();
  const [phase, setPhase] = useState<Phase>("loading");
  const [ships, setShips] = useState<CcuShip[]>([]);
  // Inputs/filtres persistants (retrouvés en revenant sur la page).
  const [fromShipId, setFromShipId] = usePersistentState<number | null>("ccuChain.from", null);
  const [toShipId, setToShipId] = usePersistentState<number | null>("ccuChain.to", null);
  const [filters, setFilters] = usePersistentState<{ onlyAvailable: boolean; maxSteps: number }>(
    "ccuChain.filters",
    { onlyAvailable: true, maxSteps: 5 },
  );
  const [result, setResult] = useState<FindPathsResult | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [, setCatalogStatus] = useState<CatalogStatus | null>(null);
  const [accountId, setAccountId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState<"from" | "to" | null>(null);
  const [sortMode, setSortMode] = usePersistentState<"cost" | "saving">("ccuChain.sort", "cost");
  const [expanded, setExpanded] = useState<Set<number>>(new Set([0]));
  // Taux de TVA appliqué à l'affichage (les prix RSI sont HT ; le store affiche TTC).
  // Persisté en AppMeta, défaut 20 % (TVA France). Synchronise le multiplicateur module.
  const [vatRate, setVatRate] = useState<number>(20);
  displayTaxMultiplier.mult = 1 + (Number.isFinite(vatRate) ? vatRate : 0) / 100;

  const shipsById = useMemo(() => {
    const map = new Map<number, CcuShip>();
    for (const s of ships) map.set(s.shipId, s);
    return map;
  }, [ships]);

  // ── Taux de TVA : chargement initial depuis AppMeta (clé partageable app-wide) ──
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const raw = await invoke<string | null>("get_app_meta", { key: VAT_RATE_META_KEY });
        const parsed = raw != null ? Number(raw) : NaN;
        if (!cancelled && Number.isFinite(parsed)) setVatRate(parsed);
      } catch {
        /* défaut 20 % conservé */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const updateVatRate = (next: number) => {
    const clamped = Math.min(100, Math.max(0, Number.isFinite(next) ? next : 0));
    setVatRate(clamped);
    void invoke("set_app_meta", { key: VAT_RATE_META_KEY, value: String(clamped) }).catch(() => {});
  };

  // ── Mount : statut catalogue → métadonnées → pré-sélection FROM ──
  useEffect(() => {
    let cancelled = false;
    void refreshStarjumpManifest(); // best-effort : top-down du manifeste réseau si dispo
    void (async () => {
      try {
        const active = await invoke<string | null>("get_active_account_id");
        const acc = active ?? "";
        if (!cancelled) setAccountId(acc);

        // Catalogue en ligne partagé (ccu-data) : chargé pour TOUS les users, sans synchro RSI.
        // Best-effort : index absent/injoignable → no-op, on retombe sur les données locales.
        await invoke("sync_ccu_from_index").catch(() => {});
        if (cancelled) return;

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

        // Pré-remplissage via navigation (ex. suggestion du dashboard) prioritaire.
        const nav = (location.state ?? null) as
          | { fromShipId?: number; toShipId?: number }
          | null;
        if (nav && typeof nav.fromShipId === "number") {
          setFromShipId(nav.fromShipId);
          if (typeof nav.toShipId === "number") setToShipId(nav.toShipId);
        } else {
          // Sinon : pré-sélectionne le vaisseau possédé au priceCents le plus bas.
          const ownedWithPrice = meta.filter((s) => s.isOwned && s.priceCents != null);
          // Défaut seulement si rien n'a été restauré (sinon on garde la sélection persistée).
          if (fromShipId == null && ownedWithPrice.length > 0) {
            const cheapest = ownedWithPrice.reduce((a, b) =>
              (b.priceCents ?? Infinity) < (a.priceCents ?? Infinity) ? b : a,
            );
            setFromShipId(cheapest.shipId);
          }
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
            // L'algo Rust ne conserve que LAYER_TOP_K (=5) chaînes par cible : demander
            // plus serait trompeur (le truncate(topN) ne ferait rien au-delà de 5).
            topN: 5,
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
          <p className="text-white/70">{t('ccu.catalogueEmpty')}</p>
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
          {t('ccu.loadingCatalogue')}
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
              {t('ccu.chooseTwoDifferent')}
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
              {t('ccu.availableOnly')}
            </label>
            <label className="flex items-center gap-2 text-sm text-white/70">
              {t('ccu.steps')}
              <Dropdown
                value={String(filters.maxSteps)}
                onChange={(v) => setFilters((f) => ({ ...f, maxSteps: Number(v) }))}
                className="w-16"
                ariaLabel={t('ccu.steps')}
                options={[1, 2, 3, 4, 5, 6, 7, 8,9,10,11,12,13,14,15].map((n) => ({ value: String(n), label: String(n) }))}
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-white/70" title={t('ccu.vatHint')}>
              {t('ccu.vat')}
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                value={vatRate}
                onChange={(e) => updateVatRate(Number(e.target.value))}
                className="w-16 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-sm text-white"
                aria-label={t('ccu.vat')}
              />
              <span className="text-white/40">%</span>
            </label>
          </section>

          {/* Résultats */}
          <section className="mt-6">
            {isSearching ? (
              <div className="flex items-center gap-2 text-white/50">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('ccu.searchingPaths')}
              </div>
            ) : !bothSelected ? (
              <p className="text-sm text-white/40">
                {t('ccu.selectFromTo')}
              </p>
            ) : !result || result.paths.length === 0 ? (
              <p className="text-sm text-white/40">{t('ccu.noPathFound')}</p>
            ) : (
              <>
                <StatsRow result={result} />

                <div className="mb-3 mt-5 flex items-baseline justify-between gap-3">
                  <div className="text-[10px] uppercase tracking-[0.2em] text-white/40">
                    <span className="font-semibold text-[var(--accent)]">{result.totalFound}</span>{" "}
                    {t('ccu.pathsAvailable', {
                      sort: sortMode === "cost" ? t('ccu.sortCost') : t('ccu.sortSaving'),
                    })}
                  </div>
                  <div className="flex gap-1">
                    <SortButton active={sortMode === "cost"} onClick={() => setSortMode("cost")}>
                      {t('ccu.sortCostBtn')}
                    </SortButton>
                    <SortButton active={sortMode === "saving"} onClick={() => setSortMode("saving")}>
                      {t('ccu.sortSavingBtn')}
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
