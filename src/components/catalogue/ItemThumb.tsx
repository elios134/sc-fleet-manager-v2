import { useEffect, useState } from "react";
import { type LucideIcon } from "lucide-react";

// Vignette d'article : image si disponible (badge API), sinon icône de repli.
// `size` en px (carré). Repris du CardThumb de CataloguePage.
export function ItemThumb({
  imageUrl,
  icon: Icon,
  active = false,
  size = 36,
}: {
  imageUrl: string | null | undefined;
  icon: LucideIcon;
  active?: boolean;
  size?: number;
}) {
  const [ok, setOk] = useState(true);
  useEffect(() => setOk(true), [imageUrl]);
  const hasImg = !!(imageUrl && ok);
  return (
    <span
      className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-[9px] bg-white/[0.04] ${
        active ? "text-[var(--accent)]" : "text-white/45"
      }`}
      style={{ width: size, height: size }}
    >
      {hasImg ? (
        <>
          <img src={imageUrl as string} alt="" loading="lazy" onError={() => setOk(false)} className="h-full w-full object-cover" />
          <span className="absolute bottom-0 right-0 rounded-tl bg-emerald-400/90 px-[3px] text-[6px] font-bold leading-[1.4] text-[#04231a]">
            API
          </span>
        </>
      ) : (
        <Icon style={{ width: size * 0.5, height: size * 0.5 }} />
      )}
    </span>
  );
}
