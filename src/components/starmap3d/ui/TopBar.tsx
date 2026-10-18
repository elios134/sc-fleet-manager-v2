import { useTranslation } from "react-i18next";
import type { Crumb, LayerKey, Layers } from "../view";

const LAYER_COLOR: Record<LayerKey, string> = {
  stations: "#a5b4fc",
  jumps: "var(--rival)",
  belts: "#d6c7a8",
  moons: "#cbd5e1",
  poi: "#7dd3fc",
};

/** Barre haute flottante : fil d'Ariane cliquable + calques en pastilles. Tokens theme.css. */
export function TopBar({
  crumbs,
  onCrumb,
  layers,
  visibleKeys,
  onToggle,
}: {
  crumbs: Crumb[];
  onCrumb: (level: "galaxy" | "system" | "object") => void;
  layers: Layers;
  visibleKeys: LayerKey[];
  onToggle: (k: LayerKey) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <nav className="glass flex items-center gap-0.5 rounded-2xl px-2 py-1.5" aria-label={t("starmap.breadcrumb")}>
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <span key={`${c.level}-${i}`} className="flex items-center gap-0.5">
              {i > 0 && <span className="text-[11px] text-white/25">›</span>}
              <button
                type="button"
                disabled={last || c.level === "poi"}
                aria-current={last ? "page" : undefined}
                onClick={() => c.level !== "poi" && onCrumb(c.level)}
                className={`rounded-lg px-2 py-1 text-[10.5px] font-bold tracking-[0.08em] ${
                  c.level === "poi" ? "" : "uppercase"
                } ${last ? "text-white" : "text-white/45 hover:bg-white/5 hover:text-white"}`}
              >
                {c.label}
              </button>
            </span>
          );
        })}
      </nav>
      <div className="glass ml-auto flex flex-wrap gap-1.5 rounded-2xl p-1.5" role="group" aria-label={t("starmap.layers")}>
        {visibleKeys.map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={layers[k]}
            onClick={() => onToggle(k)}
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-semibold ${
              layers[k] ? "border-[var(--accent)]/55 bg-[var(--accent-muted)] text-white" : "border-white/15 bg-white/[0.04] text-white/45"
            }`}
          >
            <i className="h-[7px] w-[7px] rounded-full" style={{ background: LAYER_COLOR[k] }} />
            {t(`starmap.layer.${k}`)}
          </button>
        ))}
      </div>
    </div>
  );
}
