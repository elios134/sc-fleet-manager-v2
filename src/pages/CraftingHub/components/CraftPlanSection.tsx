import type { BlueprintDetail } from "../types";
import { useCraftPlan } from "../hooks/useCraftPlan";
import { CraftNeedsCard } from "./CraftNeedsCard";
import { MiningPlanCard } from "./MiningPlanCard";

/** Haut de l'onglet Craft : ce qu'il manque pour la quantité voulue et où le miner. */
export function CraftPlanSection({ detail }: { detail: BlueprintDetail }) {
  const plan = useCraftPlan(detail);
  return (
    <div className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
      <CraftNeedsCard plan={plan} />
      <MiningPlanCard plan={plan} />
    </div>
  );
}
