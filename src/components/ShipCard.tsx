import { useState } from 'react';
import { Users, Trash2, Shield, ShieldCheck, ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { LucideIcon } from 'lucide-react';
import type { ShipRow } from '../pages/FleetPage';
import { normalizeRsiCategory } from '../lib/shipCategory';

export type ShipView = 'grid' | 'list';

interface ShipCardProps {
  shipRow: ShipRow;
  view?: ShipView;
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

/* ── Assurance : pastille (icône + libellé + teinte) au lieu de la barre V1 ── */
type InsuranceTier = 'lifetime' | 'yellow' | 'red';
const TIER: Record<InsuranceTier, { color: string; bg: string; icon: LucideIcon }> = {
  lifetime: { color: '#34d399', bg: 'rgba(52,211,153,0.14)', icon: ShieldCheck },
  yellow: { color: '#fbbf24', bg: 'rgba(251,191,36,0.14)', icon: Shield },
  red: { color: '#f87171', bg: 'rgba(248,113,113,0.14)', icon: ShieldAlert },
};

function insuranceTier(months: number | null, isLifetime: boolean): InsuranceTier {
  if (isLifetime) return 'lifetime';
  if (months === null || months < 6) return 'red';
  return 'yellow';
}
function insuranceLabel(months: number | null, isLifetime: boolean, t: TFunction): string {
  if (isLifetime) return t('shipCard.insuranceLifetime');
  if (months === null) return t('shipCard.insuranceUnknown');
  return t('shipCard.insuranceMonths', { n: months });
}

function formatPrice(price: number): string {
  return `${Math.round(price).toLocaleString('en-US')} $`;
}

export default function ShipCard({ shipRow, view = 'grid', onClick, onDelete, onExtend }: ShipCardProps) {
  const { t } = useTranslation();
  const [hover, setHover] = useState(false);
  const list = view === 'list';
  const manufacturer = shipRow.shipDataManufacturer ?? shipRow.manufacturer;

  // Acquisition : badge distinctif acheté / loué (compte à rebours). 'rsi' = rien.
  const acquisition = shipRow.acquisition;
  const daysLeft = acquisition === 'rented' ? rentalDaysLeft(shipRow.rentalExpiresAt) : null;
  const rentalExpired = acquisition === 'rented' && daysLeft != null && daysLeft <= 0;
  const acqBadge =
    acquisition === 'bought'
      ? { label: t('shipCard.acqBought'), color: '#c7c9ff', bg: 'rgba(99,102,241,0.2)' }
      : acquisition === 'rented'
        ? rentalExpired
          ? { label: t('shipCard.acqRentedExpired'), color: '#f87171', bg: 'rgba(248,113,113,0.18)' }
          : {
              label: t('shipCard.acqRentedExpiresIn', { days: daysLeft ?? 0 }),
              color: '#93c5fd',
              bg: 'rgba(96,165,250,0.18)',
            }
        : null;

  const isLti = shipRow.lti === 1;
  const tier = TIER[insuranceTier(shipRow.insuranceDuration, isLti)];
  const InsIcon = tier.icon;
  const price = shipRow.currentValueUsd;
  const crew = shipRow.crewMax;

  // Ligne « Catégorie / Sous-catégorie » (RSI) : role normalisé + classification.
  const category = normalizeRsiCategory(shipRow.shipDataRole);
  const subCategory = shipRow.shipDataClassification;
  const categoryLine = category ? (subCategory ? `${category} · ${subCategory}` : category) : null;

  const hero = (
    <div
      style={{
        position: 'relative',
        flexShrink: 0,
        width: list ? 150 : '100%',
        aspectRatio: '16 / 9',
        background: 'linear-gradient(135deg,#20202e,#14141d)',
      }}
    >
      {shipRow.imageUrl ? (
        <img
          src={shipRow.imageUrl}
          alt={shipRow.name}
          loading="lazy"
          style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
        />
      ) : (
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.2)', fontSize: 12 }} aria-hidden>
          {t('common.noImage')}
        </div>
      )}
      <span
        style={{
          position: 'absolute',
          top: 7,
          left: 8,
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'rgba(255,255,255,0.8)',
          background: 'rgba(0,0,0,0.42)',
          borderRadius: 5,
          padding: '2px 6px',
        }}
      >
        {manufacturer}
      </span>
      {acqBadge && (
        <span
          style={{
            position: 'absolute',
            top: 7,
            right: 8,
            fontSize: 10,
            color: acqBadge.color,
            background: acqBadge.bg,
            borderRadius: 5,
            padding: '2px 7px',
          }}
        >
          {acqBadge.label}
        </span>
      )}
    </div>
  );

  const body = (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: list ? '10px 12px' : '10px 12px 8px', flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 500, color: '#e8e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {shipRow.name}
          </h3>
          {price != null && price > 0 && (
            <span style={{ flexShrink: 0, fontSize: 13, color: '#a5a7f5' }}>{formatPrice(price)}</span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, fontSize: 11, color: 'rgba(255,255,255,0.42)' }}>
          {categoryLine && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{categoryLine}</span>}
          {categoryLine && crew != null && <span style={{ opacity: 0.5 }}>·</span>}
          {crew != null && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
              <Users size={12} />
              {t('shipCard.maxCrew', { n: crew })}
            </span>
          )}
        </div>

        <div style={{ marginTop: 9 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: tier.color, background: tier.bg, borderRadius: 6, padding: '3px 9px' }}>
            <InsIcon size={13} />
            {insuranceLabel(shipRow.insuranceDuration, isLti, t)}
          </span>
        </div>
      </div>

      {(onDelete || (onExtend && acquisition === 'rented')) && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 12px 12px', flexWrap: 'wrap' }}
        >
          {onExtend && acquisition === 'rented' && (
            <>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>{t('shipCard.addDays')}</span>
              {RENTAL_EXTEND_OPTIONS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => onExtend(d)}
                  style={{ fontSize: 11, fontWeight: 500, color: '#93c5fd', background: 'rgba(96,165,250,0.10)', border: '1px solid rgba(96,165,250,0.28)', borderRadius: 7, padding: '3px 8px', cursor: 'pointer' }}
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
              style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 500, color: '#f87171', background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.28)', borderRadius: 7, padding: '4px 9px', cursor: 'pointer' }}
            >
              <Trash2 size={13} />
              {t('shipCard.remove')}
            </button>
          )}
        </div>
      )}
    </div>
  );

  return (
    <article
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        border: `1px solid ${hover ? 'rgba(99,102,241,0.45)' : 'rgba(255,255,255,0.08)'}`,
        borderRadius: 12,
        overflow: 'hidden',
        background: 'rgba(255,255,255,0.035)',
        display: 'flex',
        flexDirection: list ? 'row' : 'column',
        alignItems: list ? 'stretch' : undefined,
        cursor: onClick ? 'pointer' : 'default',
        transform: hover && !list ? 'translateY(-2px)' : 'none',
        transition: 'transform 120ms ease, border-color 120ms ease',
      }}
    >
      {hero}
      {body}
    </article>
  );
}
