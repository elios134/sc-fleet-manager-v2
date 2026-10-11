export type LayerKey = "stations" | "jumps" | "belts" | "poi";
export type Layers = Record<LayerKey, boolean>;

const LABELS: { key: LayerKey; short: string; title: string }[] = [
  { key: "stations", short: "STA", title: "Stations" },
  { key: "jumps", short: "JMP", title: "Points de saut" },
  { key: "belts", short: "BLT", title: "Ceintures d'astéroïdes" },
  { key: "poi", short: "POI", title: "Lieux de surface" },
];

/** Calques on/off : chaque catégorie se barre en diagonale quand elle est éteinte. */
export function LayersControl({ layers, onToggle }: { layers: Layers; onToggle: (k: LayerKey) => void }) {
  return (
    <div className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-white/10 bg-black/60 p-1 backdrop-blur">
      {LABELS.map(({ key, short, title }) => {
        const on = layers[key];
        return (
          <button
            key={key}
            type="button"
            title={title}
            aria-pressed={on}
            onClick={() => onToggle(key)}
            className={`relative rounded px-2 py-0.5 font-mono text-[10px] font-bold tracking-wider transition-colors ${
              on ? "text-[var(--accent)]" : "text-white/35"
            }`}
          >
            {short}
            {!on && (
              <span className="pointer-events-none absolute left-1 right-1 top-1/2 h-px -rotate-[18deg] bg-white/35" />
            )}
          </button>
        );
      })}
    </div>
  );
}
