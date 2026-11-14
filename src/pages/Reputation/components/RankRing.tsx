/** Anneau « % vers le rang suivant ». */
export function RankRing({ pct, label }: { pct: number; label: string }) {
  const r = 48;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative h-28 w-28 shrink-0">
      <svg width="112" height="112" className="-rotate-90">
        <circle cx="56" cy="56" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="9" />
        <circle cx="56" cy="56" r={r} fill="none" stroke="var(--accent)" strokeWidth="9" strokeLinecap="round" strokeDasharray={`${(c * Math.max(pct, 2)) / 100} ${c}`} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <b className="block text-[22px] tabular-nums text-white">{pct}%</b>
          <span className="text-[11px] text-white/55">{label}</span>
        </div>
      </div>
    </div>
  );
}
