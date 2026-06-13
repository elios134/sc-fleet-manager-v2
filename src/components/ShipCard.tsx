import { useState } from 'react';
import { Users } from 'lucide-react';
import type { ShipRow } from '../pages/FleetPage';
import { normalizeRsiCategory } from '../lib/shipCategory';

interface ShipCardProps {
  shipRow: ShipRow;
  onClick?: () => void;
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

const textShadow = '0 1px 4px rgba(0,0,0,0.85)';

export default function ShipCard({ shipRow, onClick }: ShipCardProps) {
  const [hover, setHover] = useState(false);
  const manufacturer = shipRow.shipDataManufacturer ?? shipRow.manufacturer;
  const isLti = shipRow.lti === 1;
  const tier = insuranceTier(shipRow.insuranceDuration, isLti);
  const price = shipRow.currentValueUsd;
  const crew = shipRow.crewMax;

  // Ligne « Catégorie / Sous-catégorie » (RSI) : role normalisé + classification.
  const category = normalizeRsiCategory(shipRow.shipDataRole);
  const subCategory = shipRow.shipDataClassification;
  const categoryLine = category
    ? subCategory
      ? `${category} / ${subCategory}`
      : category
    : null;

  return (
    <article
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        border: `1px solid ${hover ? 'rgba(240,192,64,0.5)' : '#2a2a3a'}`,
        borderRadius: 10,
        overflow: 'hidden',
        background: 'rgba(18,18,28,0.85)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        flexDirection: 'column',
        cursor: onClick ? 'pointer' : 'default',
        transform: hover ? 'translateY(-3px)' : 'none',
        boxShadow: hover ? '0 12px 28px rgba(240,192,64,0.18)' : 'none',
        transition: 'transform 150ms ease, box-shadow 150ms ease, border-color 150ms ease',
      }}
    >
      {/* ── HERO : image dominante (ratio 4:3), ENTIÈRE sans déformation (contain +
          letterbox sombre si le ratio source diffère) ── */}
      <div style={{ position: 'relative', width: '100%', aspectRatio: '4 / 3', background: '#0d0d14' }}>
        {shipRow.imageUrl ? (
          <img
            src={shipRow.imageUrl}
            alt={shipRow.name}
            style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
          />
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#555',
              fontSize: 14,
            }}
            aria-hidden
          >
            Pas d'image
          </div>
        )}

        {/* Constructeur — coin haut gauche (emplacement logo RSI), texte ambre discret.
            Affiché en entier (plus de badge pour le tronquer). */}
        <span
          style={{
            position: 'absolute',
            top: 9,
            left: 11,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: '#f0c040',
            textShadow,
          }}
        >
          {manufacturer}
        </span>

        {/* Surimpression bas image : crew + catégorie/sous-catégorie (dégradé sombre) */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            padding: '24px 12px 8px',
            background: 'linear-gradient(transparent, rgba(8,8,12,0.92))',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 7,
              fontSize: 11.5,
              color: '#d6d6e4',
              textShadow,
            }}
          >
            {crew != null && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Users size={13} style={{ color: '#f0c040' }} />
                Max crew: {crew}
              </span>
            )}
            {crew != null && categoryLine && <span style={{ opacity: 0.45 }}>/</span>}
            {categoryLine && <span>{categoryLine}</span>}
          </div>
        </div>
      </div>

      {/* ── BANDE NOM + VALEUR (sous l'image, comme RSI) ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 10,
          padding: '12px 14px 10px',
        }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: 18,
            fontWeight: 700,
            color: '#e8e8f0',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {shipRow.name}
        </h3>
        {price != null && price > 0 && (
          <span style={{ flexShrink: 0, fontSize: 15, fontWeight: 700, color: '#f0c040' }}>
            ${Math.round(price).toLocaleString('en-US')}.00 USD
          </span>
        )}
      </div>

      {/* ── BARRE D'ASSURANCE tout en bas ── */}
      <div style={{ padding: '0 14px 14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ fontSize: 10, letterSpacing: '0.08em', color: '#6b6b80' }}>ASSURANCE</span>
          <span style={{ fontSize: 10, fontWeight: 700, color: TIER_COLOR[tier] }}>
            {insuranceLabel(shipRow.insuranceDuration, isLti)}
          </span>
        </div>
        <div style={{ height: 6, borderRadius: 999, background: '#23232f', overflow: 'hidden' }}>
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
    </article>
  );
}
