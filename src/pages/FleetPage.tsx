import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import ShipCard from '../components/ShipCard';
import ShipDetailsModal from '../components/ShipDetailsModal';
import StatCard from '../components/ui/StatCard';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import { computePageNumbers } from '../lib/pagination';
import { runRsiSync } from '../lib/rsiSync';
import { usePersistentState } from '../lib/uiPersist';
import { useToast } from '../components/Toast';
import { RSI_CATEGORIES, normalizeRsiCategory, type RsiCategory } from '../lib/shipCategory';

// Grille adaptative : nombre de colonnes selon la largeur de fenêtre dispo, et nombre de
// cartes par page = colonnes × lignes (lignes pleines, pas de demi-ligne).
function colsForWidth(w: number): number {
  if (w >= 1280) return 4;
  if (w >= 960) return 3;
  if (w >= 640) return 2;
  return 1;
}
function pageSizeForCols(cols: number): number {
  switch (cols) {
    case 4:
      return 12; // 3 lignes × 4
    case 3:
      return 9; // 3 lignes × 3
    case 2:
      return 8; // 4 lignes × 2
    default:
      return 6; // 1 colonne
  }
}

export type ShipRow = {
  id: number;
  name: string;
  manufacturer: string;
  role: string;
  lti: number;
  insuranceDuration: number | null;
  insuranceExpiry: string | null;
  imageUrl: string | null;
  imageTopDownUrl: string | null;
  shipDataRole: string | null;
  shipDataManufacturer: string | null;
  shipDataClassification: string | null;
  shipDataFocus: string | null;
  shipDataSize: string | null;
  crewMin: number | null;
  crewMax: number | null;
  cargoScu: number | null;
  mass: number | null;
  length: number | null;
  beam: number | null;
  height: number | null;
  scmSpeed: number | null;
  maxSpeed: number | null;
  shieldHp: number | null;
  hullHp: number | null;
  baseDps: number | null;
  emSignature: number | null;
  irSignature: number | null;
  currentValueUsd: number | null;
  isUpgraded: number | null;
  isBuybackable: number | null;
  // Acquisition (migration 0020) : origine + location.
  acquisition: string;
  shipDataId: number | null;
  rentalExpiresAt: string | null;
  rentalDurationDays: number | null;
};

type FleetStats = {
  totalFleetValueUsd: number;
  shipsOwnedCount: number;
  ltiAssetsCount: number;
  nextExpiry: { shipName: string; daysRemaining: number } | null;
};

type FleetFilter = 'ALL' | 'LTI' | RsiCategory;

type FleetPack = {
  pledgeId: number;
  pledgeName: string;
  pledgeType: string;
  createdDate: string | null;
  currentValueUsd: number | null;
  lti: number | null;
  shipsCount: number;
};

// Classe d'un bouton de pagination (état actif / désactivé) — DA V2 tokenisée.
function pagerCls(active: boolean, disabled: boolean): string {
  return [
    'flex h-[34px] min-w-[34px] items-center justify-center rounded-lg border px-2.5 text-[13px] font-semibold transition-colors',
    disabled ? 'cursor-not-allowed opacity-35' : 'cursor-pointer',
    active
      ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-foreground)]'
      : 'border-white/10 bg-white/5 text-white/70 hover:bg-white/10',
  ].join(' ');
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

export default function FleetPage() {
  const { t } = useTranslation();
  const [ships, setShips] = useState<ShipRow[]>([]);
  const [packs, setPacks] = useState<FleetPack[]>([]);
  const [stats, setStats] = useState<FleetStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noAccount, setNoAccount] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [detailShip, setDetailShip] = usePersistentState<ShipRow | null>("fleet.detailShip", null);
  // Recherche/filtre persistants (retrouvés en revenant sur la flotte).
  const [search, setSearch] = usePersistentState('fleet.search', '');
  const [filter, setFilter] = usePersistentState<FleetFilter>('fleet.filter', 'ALL');
  const [currentPage, setCurrentPage] = useState(1);
  const [cols, setCols] = useState(() => colsForWidth(window.innerWidth));
  const [activeHandle, setActiveHandle] = useState<string | null>(null);
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();

  // Recalcule le nombre de colonnes au redimensionnement (débounce léger).
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const onResize = () => {
      clearTimeout(t);
      t = setTimeout(() => setCols(colsForWidth(window.innerWidth)), 120);
    };
    window.addEventListener('resize', onResize);
    return () => {
      clearTimeout(t);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  // Catégorie RSI normalisée d'un vaisseau (depuis ShipData.role). null si non apparié.
  const shipCat = (s: ShipRow): RsiCategory | null => normalizeRsiCategory(s.shipDataRole);

  // Filtre combiné chip + recherche (nom + fabricant, insensible casse/espaces).
  const q = search.trim().toLowerCase();
  const filteredShips = ships.filter((s) => {
    if (filter === 'LTI' && s.lti !== 1) return false;
    if (filter !== 'ALL' && filter !== 'LTI' && shipCat(s) !== filter) return false;
    if (q && !(s.name.toLowerCase().includes(q) || s.manufacturer.toLowerCase().includes(q)))
      return false;
    return true;
  });

  // Chips : Tous + LTI + les catégories RSI PRÉSENTES dans la flotte (on n'affiche pas une
  // catégorie vide qui filtrerait sur rien). Vocabulaire = les 8 catégories officielles RSI.
  const presentCats = RSI_CATEGORIES.filter((c) => ships.some((s) => shipCat(s) === c));
  const chips: ReadonlyArray<readonly [string, FleetFilter]> = [
    [t('fleet.chipAll'), 'ALL'],
    ['LTI', 'LTI'],
    ...presentCats.map((c) => [c, c] as const),
  ];

  // Pagination adaptative : cartes/page = colonnes × lignes (selon l'écran). safePage borne
  // la page si le nombre de résultats/pages diminue (filtre, resize) → jamais de page vide.
  const perPage = pageSizeForCols(cols);
  const pageCount = Math.max(1, Math.ceil(filteredShips.length / perPage));
  const safePage = Math.min(currentPage, pageCount);
  const pagedShips = filteredShips.slice((safePage - 1) * perPage, safePage * perPage);

  // Retour en page 1 quand le filtre/la recherche change, à chaque (re)chargement de flotte
  // (fleet:synced) et au changement de compte/navigation — évite de rester sur une page vide.
  useEffect(() => {
    setCurrentPage(1);
  }, [filter, search, reloadTick, location.key]);

  // Si le nombre de pages diminue (resize → plus de cartes/page, ou filtre), ramène la page
  // courante dans les bornes (dernière page valide) — pas de page vide après resize.
  useEffect(() => {
    setCurrentPage((p) => Math.min(p, pageCount));
  }, [pageCount]);

  // Synchro RSI : flux partagé (src/lib/rsiSync.ts), le même que Réglages. La flotte se
  // recharge ensuite via l'event "fleet:synced" (déjà écouté). Toast de résultat.
  async function handleSync() {
    if (!activeHandle || syncing) return;
    setSyncing(true);
    try {
      const res = await runRsiSync(activeHandle);
      toast({
        type: 'success',
        title: t('fleet.rsiSyncTitle'),
        message: t('fleet.rsiSyncResult', { imported: res.imported, deleted: res.deleted }),
      });
    } catch (err) {
      toast({
        type: 'error',
        title: t('fleet.rsiSyncTitle'),
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSyncing(false);
    }
  }

  // ── Acquisition : ajout / suppression / prolongation ──
  async function handleAddShip(shipDataId: number, mode: 'bought' | 'rented', rentalDays?: number) {
    if (!activeAccountId) return;
    try {
      await invoke('add_fleet_ship', {
        accountId: activeAccountId,
        shipDataId,
        mode,
        rentalDays: rentalDays ?? null,
      });
      setAddOpen(false);
      setReloadTick((n) => n + 1);
    } catch (err) {
      toast({ type: 'error', title: t('fleet.addShip'), message: err instanceof Error ? err.message : String(err) });
    }
  }
  async function handleDeleteShip(shipId: number) {
    try {
      await invoke('delete_fleet_ship', { shipId });
      setReloadTick((n) => n + 1);
    } catch (err) {
      toast({ type: 'error', title: t('shipCard.remove'), message: err instanceof Error ? err.message : String(err) });
    }
  }
  async function handleExtendRental(shipId: number, addDays: number) {
    try {
      await invoke('extend_ship_rental', { shipId, addDays });
      setReloadTick((n) => n + 1);
    } catch (err) {
      toast({ type: 'error', title: t('shipCard.addDays'), message: err instanceof Error ? err.message : String(err) });
    }
  }

  // Recharge la flotte après une synchronisation RSI (événement émis par Settings).
  useEffect(() => {
    const pending = listen('fleet:synced', () => setReloadTick((t) => t + 1));
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
        const accountId = await invoke<string | null>('get_active_account_id');
        if (!accountId) {
          if (!cancelled) {
            setNoAccount(true);
          }
          return;
        }
        const [shipsData, statsData, packsData, accountsData] = await Promise.all([
          invoke<ShipRow[]>('get_ships', { accountId }),
          invoke<FleetStats>('get_fleet_stats', { accountId }),
          invoke<FleetPack[]>('get_fleet_packs', { accountId }),
          invoke<Array<{ id: number | string; handle: string }>>('get_accounts'),
        ]);
        if (!cancelled) {
          setNoAccount(false);
          setShips(shipsData);
          setStats(statsData);
          setPacks(packsData);
          setActiveAccountId(accountId);
          // Handle du compte actif (pour le bouton Sync RSI).
          setActiveHandle(
            accountsData.find((a) => String(a.id) === accountId)?.handle ?? null,
          );
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
    // Recharge à chaque navigation vers /fleet (changement de compte inclus)
    // ou après une synchronisation RSI (reloadTick).
  }, [location.key, reloadTick]);

  if (!loading && noAccount) {
    return (
      <div className="h-full p-6 text-white">
        <p className="p-12 text-center text-white/50">
          {t('fleet.noActiveAccount')}{' '}
          <Link to="/" className="text-[var(--accent)] underline">
            {t('fleet.selectCommander')}
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="h-full p-6 text-white">
      <header className="mb-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.12em] text-white/50">{t('fleet.subtitle')}</p>
            <h1 className="text-2xl font-bold">{t('fleet.title')}</h1>
          </div>
          <div className="inline-flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => setAddOpen(true)}
              disabled={!activeAccountId}
              title={t('fleet.addShip')}
              className="border-[var(--accent)]/50 bg-transparent text-[var(--accent)] hover:bg-[var(--accent)]/10"
            >
              ＋ {t('fleet.addShip')}
            </Button>
            <Button
              onClick={() => void handleSync()}
              disabled={syncing || !activeHandle}
              title={t('fleet.syncRsiTitle')}
            >
              <span aria-hidden className={syncing ? 'inline-block animate-spin' : 'inline-block'}>
                ⟳
              </span>
              {syncing ? t('fleet.synchronizing') : t('fleet.syncRsi')}
            </Button>
          </div>
        </div>

        {stats && (
          <div className="mt-5 flex flex-wrap gap-4">
            <div className="flex-1 basis-[140px]">
              <StatCard label={t('fleet.statTotalValue2')} value={formatUsd(stats.totalFleetValueUsd)} accent />
            </div>
            <div className="flex-1 basis-[140px]">
              <StatCard label={t('fleet.statShips')} value={String(stats.shipsOwnedCount)} accent />
            </div>
            <div className="flex-1 basis-[140px]">
              <StatCard label={t('fleet.statLtiAssets2')} value={String(stats.ltiAssetsCount)} accent />
            </div>
            <div className="flex-1 basis-[140px]">
              <StatCard label={t('fleet.statNextExpiry2')}>
                {stats.nextExpiry ? (
                  <span
                    className="text-[15px] font-bold tabular-nums"
                    style={{ color: stats.nextExpiry.daysRemaining < 30 ? '#f87171' : 'var(--accent)' }}
                  >
                    {t('fleet.expiryShort', {
                      ship: stats.nextExpiry.shipName,
                      days: stats.nextExpiry.daysRemaining,
                    })}
                  </span>
                ) : (
                  <span className="text-[15px] font-bold text-white/50">{t('fleet.none')}</span>
                )}
              </StatCard>
            </div>
          </div>
        )}

        {/* Recherche + filtres */}
        {!loading && !error && (
          <div className="mt-[18px] flex flex-wrap items-center gap-2.5">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('fleet.searchPlaceholder2')}
              className="min-w-[200px] flex-1 basis-[220px] rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[13px] text-white placeholder:text-white/40 focus:outline-none"
            />
            <div className="flex flex-wrap gap-2">
              {chips.map(([label, value]) => {
                const active = filter === value;
                return (
                  <button
                    key={value}
                    onClick={() => setFilter(value)}
                    className={[
                      'rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors',
                      active
                        ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-foreground)]'
                        : 'border-white/10 bg-white/5 text-white/70 hover:bg-white/10',
                    ].join(' ')}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </header>

      {loading && <p className="p-12 text-center text-white/50">{t('fleet.loading2')}</p>}

      {!loading && error && (
        <p className="p-12 text-center text-red-400">{t('fleet.error', { message: error })}</p>
      )}

      {!loading && !error && packs.length > 0 && (
        <section className="mb-7">
          <p className="mb-3 text-xs uppercase tracking-[0.12em] text-white/50">{t('fleet.packs')}</p>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
            {packs.map((pack) => (
              <button
                key={pack.pledgeId}
                onClick={() => navigate(`/pack/${pack.pledgeId}`)}
                className="flex w-full flex-col rounded-lg border border-white/10 bg-white/5 p-4 text-left transition-colors hover:bg-white/[0.07]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-semibold text-white">{pack.pledgeName}</span>
                  <span className="min-w-[22px] shrink-0 rounded-full border border-[var(--accent)]/30 bg-[var(--accent)]/15 px-1.5 py-px text-center text-[11px] font-bold text-[var(--accent)]">
                    {pack.shipsCount}
                  </span>
                </div>
                <p className="mt-1.5 text-xs text-white/50">
                  {t('fleet.shipsCount', { count: pack.shipsCount })}
                  {pack.currentValueUsd != null ? ` · ${formatUsd(pack.currentValueUsd)}` : ''}
                </p>
              </button>
            ))}
          </div>
        </section>
      )}

      {!loading && !error && ships.length === 0 && (
        <p className="p-12 text-center text-white/50">{t('fleet.noShipsForAccount')}</p>
      )}

      {!loading && !error && ships.length > 0 && (
        <section>
          <p className="mb-3 text-xs uppercase tracking-[0.12em] text-white/50">{t('fleet.shipsSection')}</p>
          {filteredShips.length === 0 ? (
            <p className="p-12 text-center text-white/50">{t('fleet.noShipMatch')}</p>
          ) : (
            <>
              <div className="grid gap-[18px]" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
                {pagedShips.map((ship) => (
                  <ShipCard
                    key={ship.id}
                    shipRow={ship}
                    onClick={() => setDetailShip(ship)}
                    onDelete={
                      ship.acquisition !== 'rsi'
                        ? () => void handleDeleteShip(ship.id)
                        : undefined
                    }
                    onExtend={
                      ship.acquisition === 'rented'
                        ? (d) => void handleExtendRental(ship.id, d)
                        : undefined
                    }
                  />
                ))}
              </div>
              {pageCount > 1 && (
                <nav className="mt-5 flex flex-wrap items-center justify-center gap-1.5" aria-label={t('fleet.paginationAria2')}>
                  <button
                    type="button"
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={safePage === 1}
                    className={pagerCls(false, safePage === 1)}
                  >
                    {t('fleet.prevShort')}
                  </button>
                  {computePageNumbers(safePage, pageCount).map((p, i) =>
                    p === '…' ? (
                      <span key={`e${i}`} className="px-1 text-white/50">
                        …
                      </span>
                    ) : (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setCurrentPage(p)}
                        className={pagerCls(p === safePage, false)}
                      >
                        {p}
                      </button>
                    ),
                  )}
                  <button
                    type="button"
                    onClick={() => setCurrentPage((p) => Math.min(pageCount, p + 1))}
                    disabled={safePage === pageCount}
                    className={pagerCls(false, safePage === pageCount)}
                  >
                    {t('fleet.nextShort')}
                  </button>
                </nav>
              )}
            </>
          )}
        </section>
      )}

      {detailShip && (
        <ShipDetailsModal ship={detailShip} onClose={() => setDetailShip(null)} />
      )}

      {addOpen && (
        <AddShipModal onClose={() => setAddOpen(false)} onAdd={handleAddShip} />
      )}
    </div>
  );
}

/* ───────────────────────── Modale « Ajouter un vaisseau » ───────────────────────── */

type CatalogShip = {
  id: number;
  name: string;
  manufacturer: string;
  imageUrl: string | null;
  classification: string | null;
};

const RENTAL_DURATIONS = [1, 3, 7, 30];

function AddShipModal({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (shipDataId: number, mode: 'bought' | 'rented', rentalDays?: number) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [catalog, setCatalog] = useState<CatalogShip[]>([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<CatalogShip | null>(null);
  const [mode, setMode] = useState<'bought' | 'rented'>('bought');
  const [rentalDays, setRentalDays] = useState(3);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    invoke<CatalogShip[]>('get_all_ship_data')
      .then((rows) => {
        if (!cancelled) setCatalog(rows);
      })
      .catch(() => {
        if (!cancelled) setCatalog([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = search
    ? catalog.filter((s) => {
        const q = search.toLowerCase();
        return s.name.toLowerCase().includes(q) || s.manufacturer.toLowerCase().includes(q);
      })
    : catalog;

  async function confirm() {
    if (!selected || busy) return;
    setBusy(true);
    try {
      await onAdd(selected.id, mode, mode === 'rented' ? rentalDays : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={t('fleet.addShipTitle')} onClose={onClose} size="lg" bodyClassName="">
        {/* Recherche + liste catalogue */}
        <div className="border-b border-white/10 p-4">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('fleet.addShipSearch')}
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-accent/40 focus:outline-none"
          />
          <div className="mt-3 grid max-h-[34vh] grid-cols-1 gap-1.5 overflow-y-auto sm:grid-cols-2">
            {filtered.slice(0, 200).map((s) => (
              <button
                key={s.id}
                onClick={() => setSelected(s)}
                className={[
                  'flex items-center gap-2 rounded-lg border p-2 text-left transition-colors',
                  selected?.id === s.id
                    ? 'border-accent/70 bg-accent/10'
                    : 'border-white/10 bg-white/[0.03] hover:border-accent/30',
                ].join(' ')}
              >
                {s.imageUrl ? (
                  <img src={s.imageUrl} alt="" className="h-9 w-12 shrink-0 rounded object-cover" />
                ) : (
                  <div className="h-9 w-12 shrink-0 rounded bg-white/5" />
                )}
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium text-white">{s.name}</div>
                  <div className="truncate text-[11px] text-white/40">{s.manufacturer}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Mode + confirmation */}
        <div className="flex flex-col gap-3 p-4">
          <div className="flex gap-2">
            {(['bought', 'rented'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={[
                  'flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                  mode === m
                    ? 'border-accent/60 bg-accent/10 text-accent'
                    : 'border-white/10 bg-white/5 text-white/60 hover:bg-white/10',
                ].join(' ')}
              >
                {m === 'bought' ? t('fleet.modeBought') : t('fleet.modeRented')}
              </button>
            ))}
          </div>

          {mode === 'rented' && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-white/50">{t('fleet.rentalDuration')}</span>
              {RENTAL_DURATIONS.map((d) => (
                <button
                  key={d}
                  onClick={() => setRentalDays(d)}
                  className={[
                    'rounded-md border px-3 py-1 text-xs font-semibold transition-colors',
                    rentalDays === d
                      ? 'border-blue-400/60 bg-blue-400/10 text-blue-200'
                      : 'border-white/10 bg-white/5 text-white/60 hover:bg-white/10',
                  ].join(' ')}
                >
                  {t('fleet.daysShort', { days: d })}
                </button>
              ))}
            </div>
          )}

          <Button onClick={() => void confirm()} disabled={!selected || busy} className="mt-1">
            {busy
              ? '…'
              : selected
                ? t('fleet.addShipConfirm', { name: selected.name })
                : t('fleet.addShipPick')}
          </Button>
        </div>
    </Modal>
  );
}
