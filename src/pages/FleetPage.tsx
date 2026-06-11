import { useEffect, useState, type CSSProperties } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import ShipCard from '../components/ShipCard';
import ShipDetailsModal from '../components/ShipDetailsModal';

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
  emSignature: number | null;
  irSignature: number | null;
  currentValueUsd: number | null;
  isUpgraded: number | null;
  isBuybackable: number | null;
};

type FleetStats = {
  totalFleetValueUsd: number;
  shipsOwnedCount: number;
  ltiAssetsCount: number;
  nextExpiry: { shipName: string; daysRemaining: number } | null;
};

type FleetFilter = 'ALL' | 'LTI' | 'COMBAT' | 'CARGO';

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
  const location = useLocation();
  const navigate = useNavigate();

  // Catégorie d'un vaisseau (COMBAT/CARGO…) : vient de ShipData (datamining/SC Wiki).
  function shipCategory(s: ShipRow): string | null {
    return (s.shipDataClassification || s.shipDataRole || null)?.toUpperCase() ?? null;
  }
  // ShipData peuplée ? Sinon les chips COMBAT/CARGO sont masquées (filtreraient rien).
  const hasCategoryData = ships.some((s) => shipCategory(s) !== null);

  // Filtre combiné chip + recherche (nom + fabricant, insensible casse/espaces).
  const q = search.trim().toLowerCase();
  const filteredShips = ships.filter((s) => {
    if (filter === 'LTI' && s.lti !== 1) return false;
    if (filter === 'COMBAT' && shipCategory(s) !== 'COMBAT') return false;
    if (filter === 'CARGO' && shipCategory(s) !== 'CARGO') return false;
    if (q && !(s.name.toLowerCase().includes(q) || s.manufacturer.toLowerCase().includes(q)))
      return false;
    return true;
  });

  const chips: ReadonlyArray<readonly [string, FleetFilter]> = [
    ['Tous', 'ALL'],
    ['LTI', 'LTI'],
    ...(hasCategoryData
      ? ([
          ['Combat', 'COMBAT'],
          ['Cargo', 'CARGO'],
        ] as ReadonlyArray<readonly [string, FleetFilter]>)
      : []),
  ];

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
        const [shipsData, statsData, packsData] = await Promise.all([
          invoke<ShipRow[]>('get_ships', { accountId }),
          invoke<FleetStats>('get_fleet_stats', { accountId }),
          invoke<FleetPack[]>('get_fleet_packs', { accountId }),
        ]);
        if (!cancelled) {
          setNoAccount(false);
          setShips(shipsData);
          setStats(statsData);
          setPacks(packsData);
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
          Aucun compte actif.{' '}
          <Link to="/" style={{ color: '#6366f1', textDecoration: 'underline' }}>
            Sélectionner un commandant
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <p style={subtitleStyle}>Ma Flotte</p>
        <h1 style={titleStyle}>MY FLEET</h1>

        {stats && (
          <div style={statsRowStyle}>
            <div style={statBoxStyle}>
              <p style={statLabelStyle}>Valeur totale</p>
              <p style={statValueStyle}>{formatUsd(stats.totalFleetValueUsd)}</p>
            </div>
            <div style={statBoxStyle}>
              <p style={statLabelStyle}>Vaisseaux</p>
              <p style={statValueStyle}>{stats.shipsOwnedCount}</p>
            </div>
            <div style={statBoxStyle}>
              <p style={statLabelStyle}>Assets LTI</p>
              <p style={statValueStyle}>{stats.ltiAssetsCount}</p>
            </div>
            <div style={statBoxStyle}>
              <p style={statLabelStyle}>Prochaine expiration</p>
              {stats.nextExpiry ? (
                <p
                  style={{
                    ...statValueStyle,
                    fontSize: 15,
                    color: stats.nextExpiry.daysRemaining < 30 ? '#f06060' : '#f0c040',
                  }}
                >
                  {stats.nextExpiry.shipName} · J-{stats.nextExpiry.daysRemaining}
                </p>
              ) : (
                <p style={{ ...statValueStyle, fontSize: 15, color: '#8888a0' }}>Aucune</p>
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
              placeholder="Rechercher (nom, fabricant)…"
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

      {loading && <p style={centerStyle}>Chargement de la flotte…</p>}

      {!loading && error && (
        <p style={errorStyle}>Erreur : {error}</p>
      )}

      {!loading && !error && packs.length > 0 && (
        <section style={{ marginBottom: 28 }}>
          <p style={{ ...subtitleStyle, marginBottom: 12 }}>Packs</p>
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
                  {pack.shipsCount} vaisseaux
                  {pack.currentValueUsd != null ? ` · ${formatUsd(pack.currentValueUsd)}` : ''}
                </p>
              </button>
            ))}
          </div>
        </section>
      )}

      {!loading && !error && ships.length === 0 && (
        <p style={centerStyle}>Aucun vaisseau trouvé pour ce compte.</p>
      )}

      {!loading && !error && ships.length > 0 && (
        <section>
          <p style={{ ...subtitleStyle, marginBottom: 12 }}>Vaisseaux</p>
          {filteredShips.length === 0 ? (
            <p style={centerStyle}>Aucun vaisseau ne correspond à la recherche.</p>
          ) : (
            <div style={gridStyle}>
              {filteredShips.map((ship) => (
                <ShipCard key={ship.id} shipRow={ship} onClick={() => setDetailShip(ship)} />
              ))}
            </div>
          )}
        </section>
      )}

      {detailShip && (
        <ShipDetailsModal ship={detailShip} onClose={() => setDetailShip(null)} />
      )}
    </div>
  );
}
