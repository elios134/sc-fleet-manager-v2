import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { TFunction } from "i18next";
import { Loader2 } from "lucide-react";
import { MissionBlueprintDrop, MissionListItem } from "../helpers";

/* ── Onglet Drop (blueprints obtenables, cliquables → Crafting Hub) ── */

export function DropTab({
  mission,
  onOpenBlueprint,
  t,
}: {
  mission: MissionListItem;
  onOpenBlueprint: (blueprintId: string) => void;
  t: TFunction;
}) {
  const [drops, setDrops] = useState<MissionBlueprintDrop[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDrops(null);
    invoke<MissionBlueprintDrop[]>("get_mission_blueprints", { missionUuid: mission.uuid })
      .then((d) => {
        if (!cancelled) setDrops(Array.isArray(d) ? d : []);
      })
      .catch(() => {
        if (!cancelled) setDrops([]);
      });
    return () => {
      cancelled = true;
    };
  }, [mission.uuid]);

  if (drops === null) {
    return (
      <div className="flex items-center gap-2 text-sm text-white/50">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("mission.loading")}
      </div>
    );
  }
  if (drops.length === 0) {
    return <p className="text-sm italic text-white/40">{t("mission.dropNone")}</p>;
  }

  return (
    <>
      <p className="mb-3 text-xs text-white/45">{t("mission.dropHint")}</p>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {drops.map((d) => {
          const sub = [
            d.category ?? undefined,
            d.size != null ? `S${d.size}` : undefined,
            d.weight != null ? t("mission.dropChance", { pct: Math.round(d.weight * 100) }) : undefined,
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <button
              key={d.id}
              onClick={() => onOpenBlueprint(d.id)}
              className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-3 text-left transition-colors hover:border-accent/60 hover:bg-accent/[0.06]"
            >
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold text-white">{d.name ?? "—"}</div>
                {sub && <div className="mt-0.5 truncate text-[11px] text-white/40">{sub}</div>}
              </div>
              <span className="shrink-0 text-[11px] font-semibold text-accent">{t("mission.dropOpen")}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}
