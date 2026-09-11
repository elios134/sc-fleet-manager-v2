import { useEffect, useState } from "react";
import { Rocket } from "lucide-react";
import { resolveShipTopDownUrl } from "../../../lib/starjump";
import { type ShipMeta } from "../types";

function ShipBanner({ ship }: { ship: ShipMeta | null }) {
  // Image top-down Starjump résolue depuis le nom (le champ imageTopDownUrl reste null
  // côté backend). Repli sur l'image RSI puis sur le placeholder.
  const top = ship?.imageTopDownUrl ?? resolveShipTopDownUrl(ship?.name);
  const fallback = ship?.imageUrl ?? null;
  const [src, setSrc] = useState<string | null>(top ?? fallback);
  useEffect(() => {
    setSrc(top ?? fallback);
  }, [top, fallback]);

  return (
    <div
      className="relative mb-4 flex w-full items-center justify-center overflow-hidden rounded-2xl border border-white/10"
      style={{ aspectRatio: "2.5 / 1", background: "rgba(26,27,32,0.35)" }}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(circle at center, rgba(99,102,241,0.14) 0%, transparent 70%)",
        }}
      />
      {src ? (
        <img
          src={src}
          alt={ship?.name ?? ""}
          onError={() =>
            setSrc((cur) => (cur === top && fallback != null && fallback !== top ? fallback : null))
          }
          className="relative z-10 object-contain"
          style={{
            maxWidth: "90%",
            maxHeight: "90%",
            filter: "drop-shadow(0 0 24px rgba(99,102,241,0.25))",
          }}
        />
      ) : (
        <Rocket className="relative z-10 h-14 w-14" style={{ color: "#60a5fa", opacity: 0.2 }} />
      )}
    </div>
  );
}

// Regroupe les slots-racines identiques consécutifs (même composant) → badge (N×).
// Désactivé pour les Armes (comme V1). Les slots vides ne se groupent jamais.

export { ShipBanner };
