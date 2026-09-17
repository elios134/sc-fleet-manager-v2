import { Box, Footprints } from "lucide-react";
import type { TFunction } from "i18next";
import type { ShipRow } from "../types";

interface Props {
  ship: ShipRow;
  selected: boolean;
  real: boolean;
  walkable: boolean;
  variant: "dock" | "grid";
  onClick: () => void;
  t: TFunction;
}

/* Carte vaisseau image-forward, partagée par le dock (bande horizontale) et la grille du catalogue.
   Image plein cadre + nom/constructeur en surimpression + badges Visitable/3D. */
export default function ShipCard({ ship, selected, real, walkable, variant, onClick, t }: Props) {
  // Grille du catalogue : content-visibility=auto → WebView2 saute le rendu/layout des cartes
  // hors écran (≈240 items). contain-intrinsic-size réserve la place pour éviter les sauts de
  // scroll. Le dock (bande horizontale) garde un rendu simple.
  const shape =
    variant === "dock"
      ? "h-[84px] w-[150px] shrink-0"
      : "aspect-[16/11] w-full [content-visibility:auto] [contain-intrinsic-size:auto_130px]";
  return (
    <button
      onClick={onClick}
      title={ship.name}
      className={[
        "group relative overflow-hidden rounded-xl border text-left transition",
        shape,
        selected
          ? "border-accent/70 ring-1 ring-accent shadow-lg shadow-accent/30"
          : "border-white/10 hover:-translate-y-0.5 hover:border-white/20",
        real ? "" : "opacity-60",
      ].join(" ")}
    >
      {ship.imageUrl ? (
        <img src={ship.imageUrl} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div className="absolute inset-0 grid place-items-center bg-white/[0.04]">
          <Box className="h-6 w-6 text-white/15" />
        </div>
      )}
      <div className="absolute right-1.5 top-1.5 flex gap-1">
        {walkable && (
          <span
            className="grid h-[18px] w-[18px] place-items-center rounded-md bg-[var(--accent)]/70 text-white backdrop-blur"
            title={t("ship3d.interiorVisitable")}
          >
            <Footprints className="h-3 w-3" />
          </span>
        )}
        {real && (
          <span
            className="rounded-md px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-[#2ee9a5]"
            style={{ background: "rgba(46,233,165,0.18)", backdropFilter: "blur(4px)" }}
          >
            3D
          </span>
        )}
      </div>
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent px-2 pb-1.5 pt-4">
        <div className="truncate text-[12.5px] font-semibold text-white">{ship.name}</div>
        <div className="truncate text-[9.5px] uppercase tracking-wider text-white/45">{ship.manufacturer}</div>
      </div>
    </button>
  );
}
