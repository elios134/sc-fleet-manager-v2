import { useEffect, useState } from "react";
import { Rocket } from "lucide-react";
import { resolveShipTopDownUrl } from "../../lib/starjump";

// Bandeau image top-down de la plateforme (réplique du bandeau du loadout planner de
// base) : image Starjump résolue depuis le nom, repli sur une icône.
export default function ShipTopBanner({ name }: { name: string }) {
  const [src, setSrc] = useState<string | null>(resolveShipTopDownUrl(name) ?? null);
  useEffect(() => {
    setSrc(resolveShipTopDownUrl(name) ?? null);
  }, [name]);
  return (
    <div
      className="relative mb-4 flex w-full max-w-lg items-center justify-center overflow-hidden rounded-2xl border border-white/10"
      style={{ aspectRatio: "3 / 1", background: "rgba(26,27,32,0.35)" }}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{ backgroundImage: "radial-gradient(circle at center, rgba(99,102,241,0.14) 0%, transparent 70%)" }}
      />
      {src ? (
        <img
          src={src}
          alt={name}
          onError={() => setSrc(null)}
          className="relative z-10 object-contain"
          style={{ maxWidth: "90%", maxHeight: "90%", filter: "drop-shadow(0 0 24px rgba(99,102,241,0.25))" }}
        />
      ) : (
        <Rocket className="relative z-10 h-12 w-12" style={{ color: "#60a5fa", opacity: 0.2 }} />
      )}
    </div>
  );
}
