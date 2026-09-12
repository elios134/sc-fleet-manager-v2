import { type CcuShip } from "../types";
import { formatCents } from "../helpers";

function CcuBody({
  from,
  to,
  delta,
  accent,
}: {
  from: CcuShip;
  to: CcuShip;
  delta: number;
  accent: string;
}) {
  return (
    <div>
      <div className="truncate text-xs text-white/50">{from.name}</div>
      <div className="truncate text-sm font-semibold text-white">→ {to.name}</div>
      <div className="mt-2 text-sm font-bold" style={{ color: accent }}>
        +{formatCents(delta)}
      </div>
    </div>
  );
}

export { CcuBody };
