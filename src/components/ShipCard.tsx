import { useState, type CSSProperties } from 'react';
import type { ShipRow } from '../pages/FleetPage';

interface ShipCardProps {
  shipRow: ShipRow;
  onClick?: () => void;
}

/* ── Catégories (porté de V1 getShipCategories) — career SC Wiki → label ── */
const CAREER_TO_CATEGORY: Record<string, string> = {
  Combat: 'COMBAT',
  Transporter: 'CARGO',
  Transport: 'CARGO',
  Exploration: 'EXPLO',
  Starter: 'LIGHT',
  'Multi-Role': 'COMBAT',
  Touring: 'LUXE',
  Industrial: 'INDUS',
  Mining: 'INDUS',
  'Ground Vehicle': 'GROUND',
  Racing: 'LIGHT',
};

function shipCategories(role: string | null): string[] {
  if (!role) return [];
  const cats: string[] = [];
  for (const token of role.split('/').map((s) => s.trim()).filter(Boolean)) {
    const c = CAREER_TO_CATEGORY[token];
    if (c && !cats.includes(c)) cats.push(c);
    if (cats.length >= 2) break;
  }
  return cats;
}

/* ── Barre d'assurance (porté de V1 InsuranceBar) ── */
type InsuranceTier = 'lifetime' | 'yellow' | 'red';
const TIER_COLOR: Record<InsuranceTier, string> = {
  lifetime: '#34d399',
  yellow: '#fbbf24',
  red: '#f87171',
};

function insuranceTier(months: number | null, isLifetime: boolean): InsuranceTier {
  if (isLifetime) return 'lifetime';
  if (months === null || months < 6) return 'red';
  return 'yellow';
}
function insuranceWidth(months: number | null, isLifetime: boolean): number {
  if (isLifetime) return 100;
  if (months === null) return 5;
  if (months >= 24) return 65;
  if (months >= 12) return 50;
  if (months >= 6) return 30;
  if (months >= 3) return 15;
  if (months >= 1) return 10;
  return 5;
}
function insuranceLabel(months: number | null, isLifetime: boolean): string {
  if (isLifetime) return 'À VIE';
  if (months === null) return 'INCONNU';
  return `${months} MOIS`;
}

/* ── Styles ── */
const imageStyle: CSSProperties = {
  width: '100%',
  height: 150,
  objectFit: 'contain',
  background: '#0d0d14',
  padding: 6,
};
const placeholderStyle: CSSProperties = {
  ...imageStyle,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#555',
  fontSize: 13,
};
const nameStyle: CSSProperties = { margin: 0, fontSize: 15, fontWeight: 600, color: '#e8e8f0' };
const metaStyle: CSSProperties = { margin: 0, fontSize: 12, color: '#8888a0' };

function CategoryBadge({ label }: { label: string }) {
  return (
    <span
      style={{
        padding: '2px 7px',
        borderRadius: 4,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.05em',
        color: '#bcd',
        background: 'rgba(99,102,241,0.18)',
        border: '1px solid rgba(99,102,241,0.4)',
      }}
    >
      {label}
    </span>
  );
}

function StatusBadge({ label, color }: { label: string; color: string }) {
  return (
    <span
      style={{
        padding: '2px 7px',
        borderRadius: 4,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.05em',
        color,
        background: `color-mix(in oklab, ${color} 16%, transparent)`,
        border: `1px solid color-mix(in oklab, ${color} 45%, transparent)`,
      }}
    >
      {label}
    </span>
  );
}

export default function ShipCard({ shipRow, onClick }: ShipCardProps) {
  const [hover, setHover] = useState(false);
  const manufacturer = shipRow.shipDataManufacturer ?? shipRow.manufacturer;
  const classification = shipRow.shipDataClassification;
  const isLti = shipRow.lti === 1;
  const categories = shipCategories(shipRow.shipDataRole);
  const tier = insuranceTier(shipRow.insuranceDuration, isLti);
  const price = shipRow.currentValueUsd;

  return (
    <article
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        border: `1px solid ${hover ? 'rgba(99,102,241,0.5)' : '#2a2a3a'}`,
        borderRadius: 8,
        overflow: 'hidden',
        background: '#12121c',
        display: 'flex',
        flexDirection: 'column',
        cursor: onClick ? 'pointer' : 'default',
        transform: hover ? 'translateY(-3px)' : 'none',
        boxShadow: hover ? '0 10px 26px rgba(99,102,241,0.22)' : 'none',
        transition: 'transform 150ms ease, box-shadow 150ms ease, border-color 150ms ease',
      }}
    >
      {/* Hero + badges en overlay */}
      <div style={{ position: 'relative' }}>
        {shipRow.imageUrl ? (
          <img src={shipRow.imageUrl} alt={shipRow.name} style={imageStyle} />
        ) : (
          <div style={placeholderStyle} aria-hidden>
            Pas d'image
          </div>
        )}
        <div
          style={{
            position: 'absolute',
            top: 6,
            left: 6,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 4,
            maxWidth: 'calc(100% - 12px)',
          }}
        >
          {categories.map((c) => (
            <CategoryBadge key={c} label={c} />
          ))}
          {isLti && <StatusBadge label="LTI" color="#fbbf24" />}
          {shipRow.isUpgraded === 1 && <StatusBadge label="UPGRADED" color="#818cf8" />}
          {shipRow.isBuybackable === 1 && <StatusBadge label="BUYBACK" color="#2dd4bf" />}
        </div>
      </div>

      {/* Corps */}
      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
          <h3 style={{ ...nameStyle, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {shipRow.name}
          </h3>
          {price != null && price > 0 && (
            <span style={{ flexShrink: 0, fontSize: 13, fontWeight: 700, color: '#f0c040' }}>
              ${Math.round(price).toLocaleString('en-US')} USD
            </span>
          )}
        </div>
        <p style={metaStyle}>
          {manufacturer}
          {classification ? ` · ${classification}` : ''}
        </p>

        {/* Barre d'assurance */}
        <div style={{ marginTop: 2 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
            <span style={{ fontSize: 9, letterSpacing: '0.08em', color: '#6b6b80' }}>ASSURANCE</span>
            <span style={{ fontSize: 9, fontWeight: 700, color: TIER_COLOR[tier] }}>
              {insuranceLabel(shipRow.insuranceDuration, isLti)}
            </span>
          </div>
          <div style={{ height: 4, borderRadius: 999, background: '#23232f', overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: `${insuranceWidth(shipRow.insuranceDuration, isLti)}%`,
                background: TIER_COLOR[tier],
                borderRadius: 999,
              }}
            />
          </div>
        </div>
      </div>
    </article>
  );
}
