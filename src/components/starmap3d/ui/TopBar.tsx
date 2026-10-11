import { safeName, type StarmapBodyItem } from "../starmapData";

export type Crumb = { label: string; onClick?: () => void };

/** Barre haute : fil d'Ariane (GALAXIE › SYSTÈME › CORPS › lieu) + recherche. Tokens theme.css. */
export function TopBar({
  crumbs,
  query,
  onQuery,
  results,
  onResult,
  searchPlaceholder,
}: {
  crumbs: Crumb[];
  query: string;
  onQuery: (q: string) => void;
  results: StarmapBodyItem[];
  onResult: (b: StarmapBodyItem) => void;
  searchPlaceholder: string;
}) {
  return (
    <>
      <div className="absolute left-3 top-3 z-10 flex items-center gap-1.5">
        {crumbs.map((c, i) => (
          <span key={`${c.label}-${i}`} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-white/25">›</span>}
            {c.onClick ? (
              <button
                type="button"
                onClick={c.onClick}
                className="cursor-pointer rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/55 transition-colors hover:text-[var(--accent)]"
              >
                {c.label}
              </button>
            ) : (
              <span
                className="px-1.5 py-0.5 text-[12px] font-bold uppercase tracking-[0.18em]"
                style={{ color: "var(--accent)" }}
              >
                {c.label}
              </span>
            )}
          </span>
        ))}
      </div>

      <div className="absolute right-3 top-3 z-10 w-56">
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={searchPlaceholder}
          className="w-full rounded-lg border border-white/10 bg-black/60 px-3 py-1.5 text-sm text-white placeholder:text-white/40 focus:border-[var(--accent)] focus:outline-none"
        />
        {results.length > 0 && (
          <div className="mt-1 overflow-hidden rounded-lg border border-white/10 bg-[#0a0a0f]/95 backdrop-blur">
            {results.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => onResult(b)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-white/80 transition-colors hover:bg-white/10"
              >
                <span className="flex-1 truncate">{safeName(b)}</span>
                <span className="shrink-0 font-mono text-[9px] uppercase text-white/40">{b.systemName}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
