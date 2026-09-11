import { useState } from "react";
import { getBlueprintIcon } from "../helpers";

// Vignette d'un blueprint : image de l'objet produit (API Wiki) avec repli sur l'icône de
// catégorie — si l'image manque OU échoue au chargement (onError). Même source que le
// catalogue (Item.imageUrl). `sizeClass`/`iconClass` calent la tuile sur son contexte
// (11×11 en liste, 14×14 dans l'en-tête de fiche).
function BlueprintThumb({
  imageUrl,
  category,
  name,
  sizeClass,
  iconClass,
  radiusClass = "rounded-lg",
}: {
  imageUrl?: string | null;
  category: string;
  name: string;
  sizeClass: string;
  iconClass: string;
  radiusClass?: string;
}) {
  const [failed, setFailed] = useState(false);
  const Icon = getBlueprintIcon(category);
  const showImage = !!imageUrl && !failed;
  return (
    <div
      className={`relative flex ${sizeClass} shrink-0 items-center justify-center overflow-hidden border border-white/10 ${radiusClass}`}
      style={{
        background: showImage
          ? "rgba(0,0,0,0.25)"
          : "linear-gradient(135deg, rgba(194,119,63,0.20), rgba(255,255,255,0.04))",
        color: "var(--accent)",
      }}
    >
      {showImage ? (
        <img
          src={imageUrl!}
          alt={name}
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full object-contain"
        />
      ) : (
        <Icon className={iconClass} />
      )}
    </div>
  );
}

export { BlueprintThumb };
