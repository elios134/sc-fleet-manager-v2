import type { ScopeTree } from "../aggregate";

export type Scope = { mode: "moi" } | { mode: "place"; system: string; planet: string; locId: string };

// Sélecteurs en cascade auto-remplis : seuls les scopes count>0 (de l'arbre) apparaissent.
export function ScopeSelects({
  tree,
  scope,
  onChange,
}: {
  tree: ScopeTree;
  scope: Scope;
  onChange: (s: Scope) => void;
}) {
  const place = scope.mode === "place" ? scope : null;
  const planets = place ? tree.planetsBySystem[place.system] ?? [] : [];
  const places = place ? tree.placesByPlanet[place.planet] ?? [] : [];

  const firstPlaceOf = (system: string, planet: string): Scope => {
    const p = (tree.placesByPlanet[planet] ?? [])[0];
    return p ? { mode: "place", system, planet, locId: p.locId } : { mode: "moi" };
  };

  const chooseSystem = (system: string) => {
    const planet = (tree.planetsBySystem[system] ?? [])[0]?.name;
    if (planet) onChange(firstPlaceOf(system, planet));
  };
  const choosePlanet = (planet: string) => place && onChange(firstPlaceOf(place.system, planet));
  const choosePlace = (locId: string) => place && onChange({ ...place, locId });

  const selCls =
    "appearance-none rounded-[10px] border border-white/16 bg-white/[0.03] px-3 py-2 pr-8 text-[13px] text-white focus:border-[var(--accent)] focus:outline-none";

  return (
    <div className="flex flex-wrap items-end gap-3">
      <button
        type="button"
        onClick={() => onChange({ mode: "moi" })}
        className={`rounded-[10px] border px-3 py-2 text-[13px] font-semibold ${
          scope.mode === "moi"
            ? "border-transparent bg-amber-500 text-[#1a1205]"
            : "border-amber-500/40 bg-white/[0.03] text-amber-200 hover:bg-white/[0.06]"
        }`}
      >
        Sur moi <span className="opacity-75">{tree.moiCount}</span>
      </button>
      <div className="h-9 w-px self-stretch bg-white/10" />
      <Field label="Système">
        <select className={selCls} value={place?.system ?? ""} onChange={(e) => chooseSystem(e.target.value)} disabled={scope.mode === "moi"}>
          {scope.mode === "moi" && <option value="">—</option>}
          {tree.systems.map((s) => (
            <option key={s.name} value={s.name}>{s.name} — {s.count}</option>
          ))}
        </select>
      </Field>
      <Field label="Planète / Lune">
        <select className={selCls} value={place?.planet ?? ""} onChange={(e) => choosePlanet(e.target.value)} disabled={!place}>
          {!place && <option value="">—</option>}
          {planets.map((p) => (
            <option key={p.name} value={p.name}>{p.name}{p.moon ? " (lune)" : ""} — {p.count}</option>
          ))}
        </select>
      </Field>
      <Field label="Lieu">
        <select className={selCls} value={place?.locId ?? ""} onChange={(e) => choosePlace(e.target.value)} disabled={!place}>
          {!place && <option value="">—</option>}
          {places.map((pl) => (
            <option key={pl.locId} value={pl.locId}>{pl.name} — {pl.count}</option>
          ))}
        </select>
      </Field>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="pl-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-white/40">{label}</span>
      <span className="relative">
        {children}
        <svg className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 stroke-white/40" viewBox="0 0 24 24" fill="none" strokeWidth="1.8">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </span>
    </label>
  );
}
