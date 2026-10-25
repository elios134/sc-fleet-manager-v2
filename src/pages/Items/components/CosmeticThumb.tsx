import { useEffect, useState } from "react";
import { normalizeRsiImageUrl } from "../helpers";
import ItemGlyph from "./ItemGlyph";

/** Vignette d'un objet : image RSI si elle charge, sinon glyphe neutre. `className` fixe la taille. */
export function CosmeticThumb({ imageUrl, className, glyph = 22 }: { imageUrl: string | null; className: string; glyph?: number }) {
  const src = normalizeRsiImageUrl(imageUrl);
  const [ok, setOk] = useState(true);
  useEffect(() => setOk(true), [src]);
  return (
    <span className={`grid shrink-0 place-items-center overflow-hidden rounded-[10px] border border-white/10 bg-gradient-to-br from-[var(--accent-muted)] to-transparent text-white/35 ${className}`}>
      {src && ok ? <img src={src} alt="" loading="lazy" onError={() => setOk(false)} className="h-full w-full object-cover" /> : <ItemGlyph size={glyph} />}
    </span>
  );
}
