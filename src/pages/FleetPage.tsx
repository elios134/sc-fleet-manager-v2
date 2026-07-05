import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { LayoutGrid, List } from 'lucide-react';
import ShipCard, { type ShipView } from '../components/ShipCard';
import ShipDetailsModal from '../components/ShipDetailsModal';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
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
type SortKey = 'value' | 'name' | 'ins';

// Rang d'assurance croissant (0 = meilleur) : LTI d'abord, puis plus de mois, inconnu en dernier.
function shipInsRank(s: ShipRow): number {
  if (s.lti === 1) return 0;
  if (s.insuranceDuration == null) return 9999;
  return 1000 - s.insuranceDuration;
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
  const [stats, setStats] = useState<FleetStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noAccount, setNoAccount] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [detailShip, setDetailShip] = usePersistentState<ShipRow | null>("fleet.detailShip", null);
  // Recherche/filtre persistants (retrouvés en revenant sur la flotte).
  const [search, setSearch] = usePersistentState('fleet.search', '');
  const [filter, setFilter] = usePersistentState<FleetFilter>('fleet.filter', 'ALL');
  const [sortKey, setSortKey] = usePersistentState<SortKey>('fleet.sort', 'value');
  const [view, setView] = usePersistentState<ShipView>('fleet.view', 'grid');
  const [cols, setCols] = useState(() => colsForWidth(window.innerWidth));
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const location = useLocation();
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

  // Tri appliqué à toute la flotte filtrée (valeur / nom / assurance).
  const sortedShips = [...filteredShips].sort((a, b) => {
    if (sortKey === 'name') return a.name.localeCompare(b.name);
    if (sortKey === 'ins') return shipInsRank(a) - shipInsRank(b);
    return (b.currentValueUsd ?? -1) - (a.currentValueUsd ?? -1);
  });

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
        const [shipsData, statsData] = await Promise.all([
          invoke<ShipRow[]>('get_ships', { accountId }),
          invoke<FleetStats>('get_fleet_stats', { accountId }),
        ]);
        if (!cancelled) {
          setNoAccount(false);
          setShips(shipsData);
          setStats(statsData);
          setActiveAccountId(accountId);
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
            <h1 className="text-2xl font-bold">{t('fleet.subtitle')}</h1>
            <p className="mt-1 text-sm text-white/45">
              {t('fleet.shipsCount', { count: ships.length })}
              {stats ? ` · ${formatUsd(stats.totalFleetValueUsd)}` : ''}
            </p>
          </div>
          <Button
            variant="secondary"
            onClick={() => setAddOpen(true)}
            disabled={!activeAccountId}
            title={t('fleet.addShip')}
            className="border-[var(--accent)]/50 bg-transparent text-[var(--accent)] hover:bg-[var(--accent)]/10"
          >
            ＋ {t('fleet.addShip')}
          </Button>
        </div>

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

            <div className="ml-auto flex items-center gap-2">
              <div className="flex rounded-lg border border-white/10 bg-white/5 p-0.5 text-xs">
                {([['value', 'fleet.sortValue'], ['name', 'fleet.sortName'], ['ins', 'fleet.sortInsurance']] as const).map(
                  ([k, key]) => (
                    <button
                      key={k}
                      onClick={() => setSortKey(k)}
                      className={[
                        'rounded-md px-2.5 py-1 transition-colors',
                        sortKey === k ? 'bg-[var(--accent)] text-[var(--accent-foreground)]' : 'text-white/55 hover:text-white',
                      ].join(' ')}
                    >
                      {t(key)}
                    </button>
                  ),
                )}
              </div>
              <div className="flex rounded-lg border border-white/10 bg-white/5 p-0.5">
                <button
                  aria-label={t('fleet.viewGrid')}
                  onClick={() => setView('grid')}
                  className={['rounded-md p-1.5 transition-colors', view === 'grid' ? 'bg-[var(--accent)] text-[var(--accent-foreground)]' : 'text-white/55 hover:text-white'].join(' ')}
                >
                  <LayoutGrid size={15} />
                </button>
                <button
                  aria-label={t('fleet.viewList')}
                  onClick={() => setView('list')}
                  className={['rounded-md p-1.5 transition-colors', view === 'list' ? 'bg-[var(--accent)] text-[var(--accent-foreground)]' : 'text-white/55 hover:text-white'].join(' ')}
                >
                  <List size={15} />
                </button>
              </div>
            </div>
          </div>
        )}
      </header>

      {loading && <p className="p-12 text-center text-white/50">{t('fleet.loading2')}</p>}

      {!loading && error && (
        <p className="p-12 text-center text-red-400">{t('fleet.error', { message: error })}</p>
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
              <div
                className={view === 'list' ? 'grid gap-2.5' : 'grid gap-[18px]'}
                style={{ gridTemplateColumns: view === 'list' ? '1fr' : `repeat(${cols}, 1fr)` }}
              >
                {sortedShips.map((ship) => (
                  <ShipCard
                    key={ship.id}
                    shipRow={ship}
                    view={view}
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
