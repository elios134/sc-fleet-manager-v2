import { useState } from 'react';
import { Users, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { ShipRow } from '../pages/FleetPage';
import { normalizeRsiCategory } from '../lib/shipCategory';

interface ShipCardProps {
  shipRow: ShipRow;
  onClick?: () => void;
  // Fournis uniquement pour les vaisseaux ajoutés (bought/rented).
  onDelete?: () => void;
  onExtend?: (days: number) => void;
}

const RENTAL_EXTEND_OPTIONS = [1, 3, 7, 30];

/// Jours restants avant expiration (SQLite datetime UTC « YYYY-MM-DD HH:MM:SS »).
export function rentalDaysLeft(expiresAt: string | null): number | null {
  if (!expiresAt) return null;
  const iso = expiresAt.includes('T') ? expiresAt : `${expiresAt.replace(' ', 'T')}Z`;
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  return Math.ceil(ms / 86_400_000);
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
function insuranceLabel(months: number | null, isLifetime: boolean, t: TFunction): string {
  if (isLifetime) return t('shipCard.insuranceLifetime');
  if (months === null) return t('shipCard.insuranceUnknown');
  return t('shipCard.insuranceMonths', { n: months });
}

const textShadow = '0 1px 4px rgba(0,0,0,0.85)';

export default function ShipCard({ shipRow, onClick, onDelete, onExtend }: ShipCardProps) {
  const { t } = useTranslation();
  const [hover, setHover] = useState(false);
  const manufacturer = shipRow.shipDataManufacturer ?? shipRow.manufacturer;

  // Acquisition : badge distinctif acheté / loué (compte à rebours). 'rsi' = rien.
  const acquisition = shipRow.acquisition;
  const daysLeft = acquisition === 'rented' ? rentalDaysLeft(shipRow.rentalExpiresAt) : null;
  const rentalExpired = acquisition === 'rented' && daysLeft != null && daysLeft <= 0;
  const acqBadge =
    acquisition === 'bought'
      ? { label: t('shipCard.acqBought'), color: 'var(--accent)', bg: 'var(--accent-muted)' }
      : acquisition === 'rented'
        ? rentalExpired
          ? { label: t('shipCard.acqRentedExpired'), color: '#f87171', bg: 'rgba(248,113,113,0.16)' }
          : {
              label: t('shipCard.acqRentedExpiresIn', { days: daysLeft ?? 0 }),
              color: '#60a5fa',
              bg: 'rgba(96,165,250,0.16)',
            }
        : null;
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
        border: `1px solid ${hover ? 'color-mix(in oklab, var(--accent) 50%, transparent)' : '#2a2a3a'}`,
        borderRadius: 10,
        overflow: 'hidden',
        background: 'rgba(18,18,28,0.85)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        flexDirection: 'column',
        cursor: onClick ? 'pointer' : 'default',
        transform: hover ? 'translateY(-3px)' : 'none',
        boxShadow: hover ? '0 12px 28px color-mix(in oklab, var(--accent) 18%, transparent)' : 'none',
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
            {t('common.noImage')}
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
            color: 'var(--accent)',
            textShadow,
          }}
        >
          {manufacturer}
        </span>

        {/* Badge acquisition (acheté / loué · expire dans X j / expiré) — coin haut droit */}
        {acqBadge && (
          <span
            style={{
              position: 'absolute',
              top: 9,
              right: 11,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              color: acqBadge.color,
              background: acqBadge.bg,
              border: `1px solid ${acqBadge.color}55`,
              borderRadius: 999,
              padding: '3px 8px',
              textShadow,
            }}
          >
            {acqBadge.label}
          </span>
        )}

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
                <Users size={13} style={{ color: 'var(--accent)' }} />
                {t('shipCard.maxCrew', { n: crew })}
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
          <span style={{ flexShrink: 0, fontSize: 15, fontWeight: 700, color: 'var(--accent)' }}>
            ${Math.round(price).toLocaleString('en-US')}.00 USD
          </span>
        )}
      </div>

      {/* ── BARRE D'ASSURANCE tout en bas ── */}
      <div style={{ padding: '0 14px 14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ fontSize: 10, letterSpacing: '0.08em', color: '#6b6b80' }}>{t('shipCard.insurance')}</span>
          <span style={{ fontSize: 10, fontWeight: 700, color: TIER_COLOR[tier] }}>
            {insuranceLabel(shipRow.insuranceDuration, isLti, t)}
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

      {/* Actions des vaisseaux ajoutés : +jours (loué) + suppression manuelle. */}
      {(onDelete || (onExtend && acquisition === 'rented')) && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '0 14px 14px',
            flexWrap: 'wrap',
          }}
        >
          {onExtend && acquisition === 'rented' && (
            <>
              <span style={{ fontSize: 10, color: '#6b6b80' }}>{t('shipCard.addDays')}</span>
              {RENTAL_EXTEND_OPTIONS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => onExtend(d)}
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: '#60a5fa',
                    background: 'rgba(96,165,250,0.10)',
                    border: '1px solid rgba(96,165,250,0.30)',
                    borderRadius: 7,
                    padding: '3px 8px',
                    cursor: 'pointer',
                  }}
                >
                  +{d}
                </button>
              ))}
            </>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              title={t('shipCard.remove')}
              style={{
                marginLeft: 'auto',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 11,
                fontWeight: 600,
                color: '#f87171',
                background: 'rgba(248,113,113,0.10)',
                border: '1px solid rgba(248,113,113,0.30)',
                borderRadius: 7,
                padding: '4px 9px',
                cursor: 'pointer',
              }}
            >
              <Trash2 size={13} />
              {t('shipCard.remove')}
            </button>
          )}
        </div>
      )}
    </article>
  );
}
