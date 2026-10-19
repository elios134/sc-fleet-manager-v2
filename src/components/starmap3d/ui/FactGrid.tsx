/** Grille de faits de la fiche (libellé mono en petites capitales + valeur), 3 colonnes. */
export function FactGrid({ facts }: { facts: [string, string][] }) {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {facts.map(([k, v]) => (
        <div key={k} className="min-w-0 rounded-[10px] border border-white/10 bg-white/[0.03] px-2.5 py-1.5">
          <span className="block truncate font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-white/30">{k}</span>
          <b className="mt-0.5 block truncate font-mono text-[12.5px] tabular-nums text-white" title={v}>{v}</b>
        </div>
      ))}
    </div>
  );
}
