import { Footprints } from "lucide-react";
import type { TFunction } from "i18next";
import type { ShipRow } from "../types";

interface Props {
  ship: ShipRow;
  walkable: boolean;
  onEnterInterior?: () => void;
  t: TFunction;
}

/* Bloc identité (haut-gauche du viewer) : constructeur, nom en grand, rôle + statut visitable,
   et le CTA « Visiter l'intérieur » quand disponible. Verre dépoli superposé à la scène 3D. */
export default function ShipIdentity({ ship, walkable, onEnterInterior, t }: Props) {
  const role = ship.role || ship.classification;
  return (
    <div className="pointer-events-none absolute left-5 top-5 z-10 max-w-[360px] rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-4 backdrop-blur-xl">
      <div className="text-[11px] font-medium uppercase tracking-[0.22em] text-white/55">{ship.manufacturer}</div>
      <div className="mt-1 text-balance text-3xl font-bold leading-none tracking-tight text-white">{ship.name}</div>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {role && (
          <span className="rounded-full border border-[var(--accent)]/40 bg-[var(--accent)]/20 px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-[var(--accent-foreground)]">
            {role}
          </span>
        )}
        {walkable && (
          <span className="flex items-center gap-1 rounded-full border border-[#2ee9a5]/40 bg-[#2ee9a5]/10 px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-[#2ee9a5]">
            <Footprints className="h-3 w-3" />
            {t("ship3d.interiorVisitable")}
          </span>
        )}
      </div>
      {onEnterInterior && (
        <button
          onClick={onEnterInterior}
          className="pointer-events-auto mt-3.5 flex items-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-[var(--accent)]/30 transition hover:brightness-110"
        >
          <Footprints className="h-4 w-4" />
          {t("ship3d.enterInterior")}
        </button>
      )}
    </div>
  );
}
