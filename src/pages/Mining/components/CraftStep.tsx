import { useNavigate } from "react-router";
import { Hammer } from "lucide-react";
import { hubTabPath } from "../../../app/navHubs";
import { refinedMaterials } from "../lib/steps";
import type { OreLine } from "../types";

/** Étape 4 — Fabriquer : matériaux raffinés du work order, et lien vers le Crafting. */
export function CraftStep({ ore, methodKey, t }: { ore: OreLine[]; methodKey: string | null; t: (k: string, o?: Record<string, unknown>) => string }) {
  const navigate = useNavigate();
  const mats = refinedMaterials(ore, methodKey);
  return (
    <div>
      <p className="mb-3 text-[12.5px] text-white/50">{t("mining.craftHint")}</p>
      {mats.length === 0 ? (
        <p className="text-[13px] text-white/40">{t("mining.scanEmpty")}</p>
      ) : (
        <ul className="divide-y divide-white/[0.06]">
          {mats.map((m) => (
            <li key={m.key} className="flex items-center justify-between py-2 text-[13px]">
              <span className="font-semibold text-white/90">{m.name}</span>
              <span className="tabular-nums text-white/60">{m.refinedScu.toFixed(1)} SCU</span>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={() => navigate(hubTabPath("industry", "crafting"))}
        className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2 text-[12.5px] font-semibold text-white hover:brightness-110"
      >
        <Hammer className="h-4 w-4" /> {t("mining.toCrafting")}
      </button>
    </div>
  );
}
