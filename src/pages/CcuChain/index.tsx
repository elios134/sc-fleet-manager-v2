import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { usePersistentState } from "../../lib/uiPersist";
import { ArrowUpCircle, Loader2 } from "lucide-react";
import { EmptyState } from "../../components/ui/EmptyState";
import { refreshStarjumpManifest } from "../../lib/starjump";
import { logError } from "../../lib/logError";
import { useToast } from "../../components/Toast";
import { SidePanelLayout } from "../../components/ui/SidePanel";
import { type CcuShip, type FindPathsResult, type CatalogStatus, type Phase } from "./types";
import { displayTaxMultiplier, VAT_RATE_META_KEY } from "./helpers";
import { Header } from "./components/Header";
import { ShipSelectRow } from "./components/ShipSelectRow";
import { ChainFilters } from "./components/ChainFilters";
import { ChainTimeline } from "./components/ChainTimeline";
import { PathList } from "./components/PathList";
import { WishlistPanel } from "./components/WishlistPanel";
import { sortPaths } from "./lib/chain";

/* Page CCU (maquette docs/design/maquettes-refonte-pages.html, variante A) : départ et cible
   choisis en haut, chemin retenu en frise, tous les chemins en liste, liste de souhaits à droite. */
export default function CcuChainPage() {
  const { t } = useTranslation();
  const location = useLocation();
  const { toast } = useToast();
  const [phase, setPhase] = useState<Phase>("loading");
  // « Réessayer » depuis l'état vide : relance le chargement du catalogue.
  const [retry, setRetry] = useState(0);
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
  const [sortMode, setSortMode] = usePersistentState<"cost" | "saving">("ccuChain.sort", "cost");
  // Chemin affiché dans la frise (index d'origine : 0 = le moins cher).
  const [selectedPath, setSelectedPath] = useState(0);
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
        // Échec (réseau, HTTP 404…) → toast : sinon le catalogue se fige en silence sur les données locales.
        const sync = await invoke<{ ok: boolean; reason?: string }>("sync_ccu_from_index").catch(
          (e) => ({ ok: false, reason: e instanceof Error ? e.message : String(e) }),
        );
        if (cancelled) return;
        if (!sync.ok) {
          logError("ccuChain.syncOnline", sync.reason);
          toast({ type: "warning", title: t("ccu.onlineSyncFailed"), message: sync.reason ?? "" });
        }

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
  }, [retry]); // eslint-disable-line react-hooks/exhaustive-deps

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
          setSelectedPath(0); // la frise repart sur le meilleur chemin à chaque recherche
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

  const sortedPaths = useMemo(() => (result ? sortPaths(result.paths, sortMode) : []), [result, sortMode]);
  const shownPath = result?.paths[selectedPath] ?? null;

  if (phase === "empty") {
    return (
      <div className="p-8">
        <Header />
        <div className="mt-6">
          <EmptyState
            icon={ArrowUpCircle}
            title={t("empty.ccu.title")}
            text={t("empty.ccu.text")}
            action={{
              label: t("empty.ccu.retry"),
              onClick: () => {
                setPhase("loading");
                setRetry((n) => n + 1);
              },
            }}
          />
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

          <ShipSelectRow
            ships={ships}
            from={fromShip}
            to={toShip}
            onFrom={setFromShipId}
            onTo={setToShipId}
            directCostCents={bothSelected ? (result?.directCostCents ?? null) : null}
          />
          {sameShip && (
            <div className="mt-3 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-300">
              {t('ccu.chooseTwoDifferent')}
            </div>
          )}
          <ChainFilters filters={filters} setFilters={setFilters} vatRate={vatRate} onVatRate={updateVatRate} />

          <div className="mt-5">
            <SidePanelLayout panel={<WishlistPanel ships={ships} onTarget={setToShipId} />}>
              {isSearching ? (
                <div className="flex items-center gap-2 text-white/50">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('ccu.searchingPaths')}
                </div>
              ) : !bothSelected ? (
                <p className="text-sm text-white/40">{t('ccu.selectFromTo')}</p>
              ) : !result || !shownPath ? (
                <p className="text-sm text-white/40">{t('ccu.noPathFound')}</p>
              ) : (
                <>
                  <ChainTimeline path={shownPath} shipsById={shipsById} />
                  <PathList
                    paths={sortedPaths}
                    totalFound={result.totalFound}
                    selected={selectedPath}
                    onSelect={setSelectedPath}
                    sortMode={sortMode}
                    setSortMode={setSortMode}
                    shipsById={shipsById}
                  />
                </>
              )}
            </SidePanelLayout>
          </div>
        </>
      )}
    </div>
  );
}
