import { useEffect, useState, type CSSProperties } from 'react';
import { invoke } from '@tauri-apps/api/core';
import ShipCard from '../components/ShipCard';

const ACCOUNT_ID = '';

export type ShipRow = {
  id: number;
  name: string;
  manufacturer: string;
  role: string;
  lti: number;
  imageUrl: string | null;
  imageTopDownUrl: string | null;
  shipDataRole: string | null;
  shipDataManufacturer: string | null;
  shipDataClassification: string | null;
};

type FleetStats = {
  totalFleetValueUsd: number;
  shipsOwnedCount: number;
  ltiAssetsCount: number;
};

const pageStyle: CSSProperties = {
  padding: 24,
  minHeight: '100vh',
  background: '#0a0a12',
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
  const [stats, setStats] = useState<FleetStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [shipsData, statsData] = await Promise.all([
          invoke<ShipRow[]>('get_ships', { accountId: ACCOUNT_ID }),
          invoke<FleetStats>('get_fleet_stats', { accountId: ACCOUNT_ID }),
        ]);
        if (!cancelled) {
          setShips(shipsData);
          setStats(statsData);
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
  }, []);

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
          </div>
        )}
      </header>

      {loading && <p style={centerStyle}>Chargement de la flotte…</p>}

      {!loading && error && (
        <p style={errorStyle}>Erreur : {error}</p>
      )}

      {!loading && !error && ships.length === 0 && (
        <p style={centerStyle}>Aucun vaisseau trouvé pour ce compte.</p>
      )}

      {!loading && !error && ships.length > 0 && (
        <div style={gridStyle}>
          {ships.map((ship) => (
            <ShipCard key={ship.id} shipRow={ship} />
          ))}
        </div>
      )}
    </div>
  );
}
