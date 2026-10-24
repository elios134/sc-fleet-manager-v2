import type { TFunction } from "i18next";
import type { ShipRender } from "../../../lib/ship3d";
import { fmtMB } from "../helpers";

/* Bascule de rendu du viewer (maquette validée, variante A) : « Clay » léger, « Peint » (couleurs du jeu
   sur la forme, léger) et « Texturé » (textures du jeu), selon ce que le vaisseau publie, avec le poids
   à télécharger la première fois. Le choix vaut pour les vaisseaux suivants. */
export default function RenderToggle({
  options,
  value,
  onChange,
  sizes,
  t,
}: {
  options: ShipRender[];
  value: ShipRender;
  onChange: (r: ShipRender) => void;
  sizes: Partial<Record<ShipRender, number>>;
  t: TFunction;
}) {
  return (
    <div role="group" aria-label={t("ship3d.render.label")} className="flex h-9 items-center gap-0.5 rounded-xl border border-white/10 bg-black/50 p-[3px] backdrop-blur">
      {options.map((r) => {
        const size = r === "clay" ? undefined : fmtMB(sizes[r]);
        return (
          <button
            key={r}
            type="button"
            aria-pressed={value === r}
            onClick={() => onChange(r)}
            title={t(`ship3d.render.${r}Hint`, { size })}
            className={[
              "flex h-[30px] items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-bold transition-colors",
              value === r ? "bg-[var(--accent)] text-white" : "text-white/60 hover:text-white",
            ].join(" ")}
          >
            {t(`ship3d.render.${r}`)}
            {size && <span className="text-[10.5px] font-semibold opacity-75">{size}</span>}
          </button>
        );
      })}
    </div>
  );
}
