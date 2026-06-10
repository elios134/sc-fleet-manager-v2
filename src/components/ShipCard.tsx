import type { CSSProperties } from 'react';
import type { ShipRow } from '../pages/FleetPage';

interface ShipCardProps {
  shipRow: ShipRow;
}

const cardStyle: CSSProperties = {
  border: '1px solid #2a2a3a',
  borderRadius: 8,
  overflow: 'hidden',
  background: '#12121c',
  display: 'flex',
  flexDirection: 'column',
};

const imageStyle: CSSProperties = {
  width: '100%',
  height: 140,
  objectFit: 'cover',
  background: '#1a1a28',
};

const placeholderStyle: CSSProperties = {
  ...imageStyle,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#555',
  fontSize: 13,
};

const bodyStyle: CSSProperties = {
  padding: '12px 14px',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const nameStyle: CSSProperties = {
  margin: 0,
  fontSize: 15,
  fontWeight: 600,
  color: '#e8e8f0',
};

const metaStyle: CSSProperties = {
  margin: 0,
  fontSize: 12,
  color: '#8888a0',
};

const badgeStyle: CSSProperties = {
  alignSelf: 'flex-start',
  marginTop: 6,
  padding: '2px 8px',
  borderRadius: 4,
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.05em',
  background: '#2a2200',
  color: '#f0c040',
  border: '1px solid #5a4800',
};

export default function ShipCard({ shipRow }: ShipCardProps) {
  const manufacturer = shipRow.shipDataManufacturer ?? shipRow.manufacturer;
  const classification = shipRow.shipDataClassification;
  const role = shipRow.shipDataRole ?? shipRow.role;
  const isLti = shipRow.lti === 1;

  return (
    <article style={cardStyle}>
      {shipRow.imageUrl ? (
        <img src={shipRow.imageUrl} alt={shipRow.name} style={imageStyle} />
      ) : (
        <div style={placeholderStyle} aria-hidden>
          Pas d'image
        </div>
      )}
      <div style={bodyStyle}>
        <h3 style={nameStyle}>{shipRow.name}</h3>
        <p style={metaStyle}>{manufacturer}</p>
        <p style={metaStyle}>{role}</p>
        {classification && <p style={metaStyle}>{classification}</p>}
        {isLti && <span style={badgeStyle}>LTI</span>}
      </div>
    </article>
  );
}
