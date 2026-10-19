import { useTranslation } from "react-i18next";
import { MapPin } from "lucide-react";
import type { Crumb, LayerKey, Layers } from "../view";

// Couleurs des calques, depuis les jetons du thème (mêmes teintes que le rail).
const LAYER_COLOR: Record<LayerKey, string> = {
  stations: "color-mix(in oklab, var(--accent) 55%, white)",
  jumps: "var(--rival)",
  belts: "color-mix(in oklab, var(--amber) 45%, var(--muted))",
  moons: "var(--muted)",
  poi: "var(--accent)",
  light: "var(--amber)",
};

/** Barre haute flottante : fil d'Ariane cliquable + calques en pastilles. Tokens theme.css. */
export function TopBar({
  crumbs,
  onCrumb,
  layers,
  visibleKeys,
  onToggle,
  hereLabel,
  onHere,
}: {
  crumbs: Crumb[];
  onCrumb: (level: "galaxy" | "system" | "object") => void;
  layers: Layers;
  visibleKeys: LayerKey[];
  onToggle: (k: LayerKey) => void;
  /** Lieu du joueur (Game.log) ; null = inconnu (bouton inactif, astuce au survol). */
  hereLabel: string | null;
  onHere: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2.5">
      <nav className="glass flex min-w-0 max-w-full items-center gap-0.5 overflow-hidden rounded-2xl px-2 py-1.5" aria-label={t("starmap.breadcrumb")}>
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <span key={`${c.level}-${i}`} className="flex min-w-0 items-center gap-0.5">
              {i > 0 && <span className="text-[11px] text-white/25">›</span>}
              <button
                type="button"
                disabled={last || c.level === "poi" || c.level === "selection"}
                aria-current={last ? "page" : undefined}
                onClick={() => c.level !== "poi" && c.level !== "selection" && onCrumb(c.level)}
                title={c.label}
                className={`min-w-0 max-w-[180px] truncate rounded-lg px-2 py-1 text-[10.5px] font-bold tracking-[0.08em] ${
                  c.level === "poi" ? "" : "uppercase"
                } ${last ? "text-white" : "text-white/45 hover:bg-white/5 hover:text-white"}`}
              >
                {c.label}
              </button>
            </span>
          );
        })}
      </nav>
      <button
        type="button"
        onClick={onHere}
        disabled={!hereLabel}
        title={hereLabel ?? t("starmap.hereUnknown")}
        className="glass flex min-w-0 max-w-[220px] items-center gap-1.5 rounded-2xl px-3 py-2 text-[11.5px] font-semibold text-white enabled:hover:bg-white/10 disabled:text-white/35"
      >
        <MapPin className={`h-3.5 w-3.5 shrink-0 ${hereLabel ? "text-emerald-400" : ""}`} />
        <span className="truncate">{hereLabel ?? t("starmap.here")}</span>
      </button>
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
