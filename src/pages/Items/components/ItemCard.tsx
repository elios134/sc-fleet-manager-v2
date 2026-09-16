import type { TFunction } from "i18next";
import type { HangarItem } from "../types";
import { KIND_META, normalizeRsiImageUrl } from "../helpers";
import ItemGlyph from "./ItemGlyph";

/* Carte objet unique image-forward (carré) : image plein cadre + scrim bas
   (titre / constructeur) + badge de type coloré. Même langage que Ship3D/Catalogue. */
export default function ItemCard({
  item,
  onClick,
  t,
}: {
  item: HangarItem;
  onClick: () => void;
  t: TFunction;
}) {
  const meta = item.kind ? KIND_META[item.kind] : undefined;
  const img = normalizeRsiImageUrl(item.imageUrl);
  return (
    <button
      type="button"
      onClick={onClick}
      title={item.title}
      className="group relative aspect-square overflow-hidden rounded-xl border border-white/10 text-left transition hover:-translate-y-0.5 hover:border-white/20"
    >
      {img ? (
        <img
          src={img}
          alt=""
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
      ) : (
        <div
          className="absolute inset-0 grid place-items-center"
          style={{
            background: meta
              ? `radial-gradient(120% 90% at 50% 25%, ${meta.color}22, #0a0b12)`
              : "rgba(255,255,255,0.04)",
          }}
        >
          {meta ? <meta.Icon className="h-10 w-10" style={{ color: meta.color, opacity: 0.9 }} /> : (
            <span className="text-white/20">
              <ItemGlyph size={40} />
            </span>
          )}
        </div>
      )}

      {meta && (
        <span
          className="absolute left-1.5 top-1.5 z-[2] flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide backdrop-blur"
          style={{ background: `${meta.color}2e`, color: meta.color, border: `1px solid ${meta.color}55` }}
        >
          <meta.Icon className="h-3 w-3" />
          {t(meta.labelKey)}
        </span>
      )}

      <div className="absolute inset-x-0 bottom-0 z-[2] bg-gradient-to-t from-black/90 to-transparent px-2 pb-1.5 pt-6">
        <div className="line-clamp-2 text-[12.5px] font-semibold leading-tight text-white">{item.title}</div>
        {item.manufacturer && (
          <div className="mt-0.5 truncate text-[9.5px] uppercase tracking-wider text-white/45">
            {item.manufacturer}
          </div>
        )}
      </div>
    </button>
  );
}
