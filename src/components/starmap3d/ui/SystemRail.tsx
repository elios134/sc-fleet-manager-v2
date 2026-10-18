import { useTranslation } from "react-i18next";
import { safeName, type StarmapBodyItem } from "../starmapData";
import { bodyTree, type SystemSummary, type TreeKind } from "../panel";

const DOT: Record<TreeKind, string> = {
  star: "radial-gradient(circle at 35% 35%, #fffbe8, #ffd27a)",
  planet: "radial-gradient(circle at 35% 35%, #c7d2fe, #4f46e5)",
  moon: "radial-gradient(circle at 35% 35%, #e2e8f0, #64748b)",
  station: "#a5b4fc",
  belt: "#d6c7a8",
  jump: "var(--rival)",
};

/** Rail gauche : recherche, puces de système, arbre des lieux (enfants sous le corps choisi). */
export function SystemRail({
  bodies,
  systems,
  systemId,
  selectedId,
  query,
  onQuery,
  onSystem,
  onSelect,
}: {
  bodies: StarmapBodyItem[];
  systems: SystemSummary[];
  systemId: string;
  selectedId: string | null;
  query: string;
  onQuery: (q: string) => void;
  onSystem: (id: string) => void;
  onSelect: (b: StarmapBodyItem) => void;
}) {
  const { t } = useTranslation();
  const nodes = bodyTree(bodies, systemId, selectedId, query);
  let lastGroup = "";
  return (
    <aside className="glass flex min-h-0 flex-col overflow-hidden rounded-2xl" aria-label={t("starmap.railLabel")}>
      <header className="flex flex-col gap-2.5 border-b border-white/10 p-3.5">
        <input
          id="starmap-search"
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={t("starmap.searchPlaces")}
          className="w-full rounded-full border border-white/15 bg-white/5 px-3.5 py-2 text-[13px] text-white placeholder:text-white/30 focus:border-[var(--accent)]/60 focus:outline-none"
        />
        <div className="flex gap-1.5" role="group" aria-label={t("starmap.systems")}>
          {systems.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={s.id === systemId}
              onClick={() => onSystem(s.id)}
              className={`min-w-0 flex-1 rounded-[10px] border px-2 py-1.5 text-left ${
                s.id === systemId ? "border-[var(--accent)]/60 bg-[var(--accent-muted)]" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"
              }`}
            >
              <b className="block truncate text-[12.5px] text-white">{s.name}</b>
              <small className="block truncate text-[10.5px] text-white/45">{t("starmap.sysCount", { planets: s.planets, moons: s.moons })}</small>
            </button>
          ))}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-2 [scrollbar-width:thin]">
        {nodes.length === 0 && <p className="px-3 py-6 text-center text-xs text-white/40">{t("starmap.noPlace")}</p>}
        {nodes.map((n) => {
          const group = n.depth === 1 ? lastGroup : n.kind === "planet" ? "planets" : n.kind;
          const head = group !== lastGroup && n.depth === 0;
          lastGroup = group;
          const current = n.body.id === selectedId;
          return (
            <div key={n.body.id}>
              {head && (
                <p className="px-2.5 pb-1 pt-2.5 text-[10px] font-extrabold uppercase tracking-[0.12em] text-white/30">
                  {t(`starmap.tree.${group}`)}
                </p>
              )}
              <button
                type="button"
                aria-current={current}
                onClick={() => onSelect(n.body)}
                className={`flex w-full items-center gap-2.5 rounded-[9px] py-1.5 text-left hover:bg-white/5 ${
                  n.depth === 1 ? "pl-8 pr-2.5 text-[12.5px] text-white/75" : "px-2.5 text-[13px] text-white"
                } ${current ? "bg-[var(--accent-muted)] shadow-[inset_2px_0_0_var(--accent)]" : ""}`}
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: DOT[n.kind] }} />
                <span className="min-w-0 flex-1 truncate">{safeName(n.body)}</span>
                {n.depth === 1 ? (
                  <span className="text-[10.5px] text-white/30">{t(`starmap.kind.${n.kind}`)}</span>
                ) : n.kind === "planet" && n.body.distance != null ? (
                  <span className="font-mono text-[10.5px] text-white/30">{n.body.distance.toFixed(2)}</span>
                ) : query ? (
                  <span className="font-mono text-[9.5px] uppercase text-white/30">{n.body.systemName}</span>
                ) : null}
              </button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
