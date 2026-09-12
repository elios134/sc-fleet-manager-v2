// Liste de barres horizontales (top véhicules / lieux / dépenses). Générique.

export type BarRow = { name: string; value: number; valueLabel: string; sub?: string };

export function StatBars({
  rows,
  color = "var(--accent)",
  empty,
}: {
  rows: BarRow[];
  color?: string;
  empty: string;
}) {
  if (rows.length === 0) {
    return <p className="py-6 text-center text-xs text-white/40">{empty}</p>;
  }
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div className="flex flex-col gap-3">
      {rows.map((r) => (
        <div key={r.name} className="grid items-center gap-3" style={{ gridTemplateColumns: "1fr 92px" }}>
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="truncate text-[13px] font-medium text-white/90" title={r.name}>
              {r.name}
            </span>
            <span className="h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${Math.round((r.value / max) * 100)}%`,
                  background: `linear-gradient(90deg, color-mix(in oklab, ${color} 70%, transparent), ${color})`,
                }}
              />
            </span>
          </div>
          <span className="text-right text-[13px] font-semibold tabular-nums text-white/90">
            {r.valueLabel}
            {r.sub && <small className="block text-[10px] font-normal text-white/35">{r.sub}</small>}
          </span>
        </div>
      ))}
    </div>
  );
}
