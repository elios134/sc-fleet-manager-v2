import { RotateCw, Crosshair, Maximize2, LayoutGrid } from "lucide-react";
import type { TFunction } from "i18next";

interface Props {
  autoRotate: boolean;
  onToggleAutoRotate: () => void;
  onRecenter: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onOpenCatalog: () => void;
  t: TFunction;
}

const btn = (on: boolean) =>
  [
    "flex h-9 w-9 items-center justify-center rounded-xl border backdrop-blur transition-colors",
    on
      ? "border-[var(--accent)]/60 bg-[var(--accent)]/20 text-white"
      : "border-white/10 bg-black/50 text-white/60 hover:bg-black/70 hover:text-white",
  ].join(" ");

/* Barre d'outils du viewer orbital (haut-droite) : rotation auto / recentrer / plein écran,
   + bouton Catalogue qui déploie la grille plein écran. */
export default function ViewerTools(p: Props) {
  return (
    <div className="absolute right-5 top-5 z-10 flex gap-2">
      <button type="button" aria-pressed={p.autoRotate} onClick={p.onToggleAutoRotate} title={p.t("ship3d.autoRotate")} className={btn(p.autoRotate)}>
        <RotateCw className="h-4 w-4" />
      </button>
      <button type="button" onClick={p.onRecenter} title={p.t("ship3d.recenter")} className={btn(false)}>
        <Crosshair className="h-4 w-4" />
      </button>
      <button type="button" onClick={p.onToggleFullscreen} title={p.t("ship3d.fullscreen")} className={btn(p.isFullscreen)}>
        <Maximize2 className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={p.onOpenCatalog}
        title={p.t("ship3d.catalog")}
        className="flex h-9 items-center gap-2 rounded-xl border border-white/20 bg-black/50 px-3.5 text-[13px] font-semibold uppercase tracking-wider text-white backdrop-blur transition-colors hover:bg-black/70"
      >
        <LayoutGrid className="h-4 w-4" />
        {p.t("ship3d.catalog")}
      </button>
    </div>
  );
}
