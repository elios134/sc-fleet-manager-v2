import type { TFunction } from "i18next";
import type { PledgeGroup } from "../types";
import { normalizeRsiImageUrl } from "../helpers";
import ItemGlyph from "./ItemGlyph";

/* Carte pack (pledge multi-objets) : effet « pile » + compteur « +N ».
   Le clic ouvre la modale détaillée du pack (logique conservée). */
export default function ItemPackageCard({
  pledge,
  onView,
  t,
}: {
  pledge: PledgeGroup;
  onView: () => void;
  t: TFunction;
}) {
  const count = pledge.items.length;
  const heroImg = normalizeRsiImageUrl(pledge.items.find((it) => it.imageUrl)?.imageUrl ?? null);
  return (
    <button
      type="button"
      onClick={onView}
      title={pledge.name}
      className="group relative aspect-square overflow-hidden rounded-xl border border-white/10 text-left transition hover:-translate-y-0.5 hover:border-white/20"
    >
      {/* Fond hachuré = repère « pack » */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "repeating-linear-gradient(135deg,rgba(255,255,255,.03) 0 10px,rgba(255,255,255,.05) 10px 20px)",
        }}
      />
      {/* Pile : 3 feuillets décalés */}
      <div className="absolute inset-3 rounded-lg border border-white/15 bg-[rgba(12,13,22,0.6)]">
        <span className="absolute inset-0 translate-x-1.5 translate-y-1.5 rounded-lg border border-white/10 opacity-50" />
        <span className="absolute inset-0 translate-x-3 translate-y-3 rounded-lg border border-white/10 opacity-25" />
        <span className="absolute inset-0 grid place-items-center overflow-hidden rounded-lg">
          {heroImg ? (
            <img src={heroImg} alt="" loading="lazy" className="h-full w-full object-cover opacity-90" />
          ) : (
            <span className="text-white/20">
              <ItemGlyph size={40} />
            </span>
          )}
        </span>
      </div>

      <span className="absolute right-2 top-2 z-[2] rounded-full bg-[var(--accent)] px-2 py-0.5 text-[11px] font-bold tabular-nums text-white">
        {t("items.packCount", { n: count })}
      </span>

      <div className="absolute inset-x-0 bottom-0 z-[2] bg-gradient-to-t from-black/90 to-transparent px-2 pb-1.5 pt-6">
        <div className="line-clamp-2 text-[12.5px] font-semibold leading-tight text-white">{pledge.name}</div>
        <div className="mt-0.5 truncate text-[9.5px] uppercase tracking-wider text-white/45">
          {t("items.itemsCount", { n: count })}
        </div>
      </div>
    </button>
  );
}
