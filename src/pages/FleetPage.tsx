import { useEffect, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import ShipCard from '../components/ShipCard';
import ShipDetailsModal from '../components/ShipDetailsModal';
import { computePageNumbers } from '../lib/pagination';
import { runRsiSync } from '../lib/rsiSync';
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

const pageStyle: CSSProperties = {
  padding: 24,
  height: '100%',
  color: '#e8e8f0',
  fontFamily: 'system-ui, sans-serif',
};

const headerStyle: CSSProperties = {
  marginBottom: 24,
};

const titleStyle: CSSProperties = {
  margin: '0 0 4px',
  fontSize: 24,
  fontWeight: 700,
};

const subtitleStyle: CSSProperties = {
  margin: 0,
  fontSize: 12,
  letterSpacing: '0.12em',
  color: '#8888a0',
  textTransform: 'uppercase',
};

const statsRowStyle: CSSProperties = {
  display: 'flex',
  gap: 16,
  marginTop: 20,
  flexWrap: 'wrap',
};

const statBoxStyle: CSSProperties = {
  flex: '1 1 140px',
  padding: '12px 16px',
  borderRadius: 8,
  background: '#12121c',
  border: '1px solid #2a2a3a',
};

const statLabelStyle: CSSProperties = {
  margin: 0,
  fontSize: 11,
  color: '#8888a0',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
};

const statValueStyle: CSSProperties = {
  margin: '4px 0 0',
  fontSize: 22,
  fontWeight: 700,
  color: '#f0c040',
};

const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
  gap: 16,
};

// Grille des vaisseaux : nombre de colonnes dynamique (cf. colsForWidth) appliqué inline.
// Les packs gardent gridStyle (auto-fill).
const shipsGridBaseStyle: CSSProperties = {
  display: 'grid',
  gap: 18,
};

const pagerStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  gap: 6,
  marginTop: 20,
  flexWrap: 'wrap',
};

function pagerBtnStyle(active: boolean, disabled: boolean): CSSProperties {
  return {
    minWidth: 34,
    height: 34,
    padding: '0 10px',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.35 : 1,
    color: active ? '#0a0a0f' : '#b8b8c8',
    background: active ? '#f0c040' : '#12121c',
    border: `1px solid ${active ? '#f0c040' : '#2a2a3a'}`,
  };
}

const packCardStyle: CSSProperties = {
  textAlign: 'left',
  width: '100%',
  padding: '14px 16px',
  borderRadius: 8,
  background: '#12121c',
  border: '1px solid #2a2a3a',
  cursor: 'pointer',
  display: 'flex',
  flexDirection: 'column',
};

const packCountStyle: CSSProperties = {
  flexShrink: 0,
  minWidth: 22,
  textAlign: 'center',
  padding: '1px 7px',
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 700,
  color: '#f0c040',
  background: '#2a2200',
  border: '1px solid #5a4800',
};

const centerStyle: CSSProperties = {
  padding: 48,
  textAlign: 'center',
  color: '#8888a0',
};

const errorStyle: CSSProperties = {
  ...centerStyle,
  color: '#f06060',
};

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
  const [detailShip, setDetailShip] = useState<ShipRow | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FleetFilter>('ALL');
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
      <div style={pageStyle}>
        <p style={centerStyle}>
          {t('fleet.noActiveAccount')}{' '}
          <Link to="/" style={{ color: '#6366f1', textDecoration: 'underline' }}>
            {t('fleet.selectCommander')}
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <p style={subtitleStyle}>{t('fleet.subtitle')}</p>
            <h1 style={titleStyle}>{t('fleet.title')}</h1>
          </div>
          <div style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            disabled={!activeAccountId}
            title={t('fleet.addShip')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '9px 16px',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: !activeAccountId ? 'not-allowed' : 'pointer',
              opacity: !activeAccountId ? 0.55 : 1,
              color: '#f0c040',
              background: 'transparent',
              border: '1px solid rgba(240,192,64,0.5)',
            }}
          >
            ＋ {t('fleet.addShip')}
          </button>
          <button
            type="button"
            onClick={() => void handleSync()}
            disabled={syncing || !activeHandle}
            title={t('fleet.syncRsiTitle')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '9px 16px',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: syncing || !activeHandle ? 'not-allowed' : 'pointer',
              opacity: syncing || !activeHandle ? 0.55 : 1,
              color: '#0a0a0f',
              background: '#f0c040',
              border: '1px solid #f0c040',
            }}
          >
            <span
              aria-hidden
              style={{
                display: 'inline-block',
                animation: syncing ? 'fleet-spin 0.9s linear infinite' : 'none',
              }}
            >
              ⟳
            </span>
            {syncing ? t('fleet.synchronizing') : t('fleet.syncRsi')}
          </button>
          </div>
        </div>
        <style>{'@keyframes fleet-spin { to { transform: rotate(360deg); } }'}</style>

        {stats && (
          <div style={statsRowStyle}>
            <div style={statBoxStyle}>
              <p style={statLabelStyle}>{t('fleet.statTotalValue2')}</p>
              <p style={statValueStyle}>{formatUsd(stats.totalFleetValueUsd)}</p>
            </div>
            <div style={statBoxStyle}>
              <p style={statLabelStyle}>{t('fleet.statShips')}</p>
              <p style={statValueStyle}>{stats.shipsOwnedCount}</p>
            </div>
            <div style={statBoxStyle}>
              <p style={statLabelStyle}>{t('fleet.statLtiAssets2')}</p>
              <p style={statValueStyle}>{stats.ltiAssetsCount}</p>
            </div>
            <div style={statBoxStyle}>
              <p style={statLabelStyle}>{t('fleet.statNextExpiry2')}</p>
              {stats.nextExpiry ? (
                <p
                  style={{
                    ...statValueStyle,
                    fontSize: 15,
                    color: stats.nextExpiry.daysRemaining < 30 ? '#f06060' : '#f0c040',
                  }}
                >
                  {t('fleet.expiryShort', {
                    ship: stats.nextExpiry.shipName,
                    days: stats.nextExpiry.daysRemaining,
                  })}
                </p>
              ) : (
                <p style={{ ...statValueStyle, fontSize: 15, color: '#8888a0' }}>
                  {t('fleet.none')}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Recherche + filtres */}
        {!loading && !error && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 10,
              marginTop: 18,
            }}
          >
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('fleet.searchPlaceholder2')}
              style={{
                flex: '1 1 220px',
                minWidth: 200,
                padding: '8px 12px',
                borderRadius: 8,
                background: '#12121c',
                border: '1px solid #2a2a3a',
                color: '#e8e8f0',
                fontSize: 13,
                outline: 'none',
              }}
            />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {chips.map(([label, value]) => {
                const active = filter === value;
                return (
                  <button
                    key={value}
                    onClick={() => setFilter(value)}
                    style={{
                      padding: '7px 14px',
                      borderRadius: 999,
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                      color: active ? '#0a0a0f' : '#b8b8c8',
                      background: active ? '#f0c040' : '#12121c',
                      border: `1px solid ${active ? '#f0c040' : '#2a2a3a'}`,
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </header>

      {loading && <p style={centerStyle}>{t('fleet.loading2')}</p>}

      {!loading && error && (
        <p style={errorStyle}>{t('fleet.error', { message: error })}</p>
      )}

      {!loading && !error && packs.length > 0 && (
        <section style={{ marginBottom: 28 }}>
          <p style={{ ...subtitleStyle, marginBottom: 12 }}>{t('fleet.packs')}</p>
          <div style={gridStyle}>
            {packs.map((pack) => (
              <button
                key={pack.pledgeId}
                onClick={() => navigate(`/pack/${pack.pledgeId}`)}
                style={packCardStyle}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                  }}
                >
                  <span
                    style={{
                      fontWeight: 600,
                      color: '#e8e8f0',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {pack.pledgeName}
                  </span>
                  <span style={packCountStyle}>{pack.shipsCount}</span>
                </div>
                <p style={{ margin: '6px 0 0', fontSize: 12, color: '#8888a0' }}>
                  {t('fleet.shipsCount', { count: pack.shipsCount })}
                  {pack.currentValueUsd != null ? ` · ${formatUsd(pack.currentValueUsd)}` : ''}
                </p>
              </button>
            ))}
          </div>
        </section>
      )}

      {!loading && !error && ships.length === 0 && (
        <p style={centerStyle}>{t('fleet.noShipsForAccount')}</p>
      )}

      {!loading && !error && ships.length > 0 && (
        <section>
          <p style={{ ...subtitleStyle, marginBottom: 12 }}>{t('fleet.shipsSection')}</p>
          {filteredShips.length === 0 ? (
            <p style={centerStyle}>{t('fleet.noShipMatch')}</p>
          ) : (
            <>
              <div style={{ ...shipsGridBaseStyle, gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
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
                <nav style={pagerStyle} aria-label={t('fleet.paginationAria2')}>
                  <button
                    type="button"
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={safePage === 1}
                    style={pagerBtnStyle(false, safePage === 1)}
                  >
                    {t('fleet.prevShort')}
                  </button>
                  {computePageNumbers(safePage, pageCount).map((p, i) =>
                    p === '…' ? (
                      <span key={`e${i}`} style={{ color: '#8888a0', padding: '0 4px' }}>
                        …
                      </span>
                    ) : (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setCurrentPage(p)}
                        style={pagerBtnStyle(p === safePage, false)}
                      >
                        {p}
                      </button>
                    ),
                  )}
                  <button
                    type="button"
                    onClick={() => setCurrentPage((p) => Math.min(pageCount, p + 1))}
                    disabled={safePage === pageCount}
                    style={pagerBtnStyle(false, safePage === pageCount)}
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" onClick={onClose}>
      <div className="absolute inset-0 bg-black/65" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative z-10 flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border backdrop-blur-2xl"
        style={{ background: 'rgba(16,18,24,0.96)', borderColor: 'rgba(240,192,64,0.2)' }}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <h2 className="text-base font-semibold text-white">{t('fleet.addShipTitle')}</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-white/50 hover:bg-white/10 hover:text-white">
            ✕
          </button>
        </div>

        {/* Recherche + liste catalogue */}
        <div className="border-b border-white/10 p-4">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('fleet.addShipSearch')}
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-amber-400/40 focus:outline-none"
          />
          <div className="mt-3 grid max-h-[34vh] grid-cols-1 gap-1.5 overflow-y-auto sm:grid-cols-2">
            {filtered.slice(0, 200).map((s) => (
              <button
                key={s.id}
                onClick={() => setSelected(s)}
                className={[
                  'flex items-center gap-2 rounded-lg border p-2 text-left transition-colors',
                  selected?.id === s.id
                    ? 'border-amber-400/70 bg-amber-400/10'
                    : 'border-white/10 bg-white/[0.03] hover:border-amber-400/30',
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
                    ? 'border-amber-400/60 bg-amber-400/10 text-amber-200'
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

          <button
            onClick={() => void confirm()}
            disabled={!selected || busy}
            className="mt-1 rounded-lg bg-[#f0c040] px-4 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy
              ? '…'
              : selected
                ? t('fleet.addShipConfirm', { name: selected.name })
                : t('fleet.addShipPick')}
          </button>
        </div>
      </div>
    </div>
  );
}
