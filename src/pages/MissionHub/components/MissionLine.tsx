import type { TFunction } from "i18next";
import { Star, CircleDot, Clock } from "lucide-react";
import { FAMILY, FAMILY_ICON, MissionListItem, mapScopeFamily } from "../helpers";

/* ─────────────────────────── Ligne de mission (gauche) ─────────────────────── */

export function MissionLine({
  mission,
  selected,
  isFavorite,
  onClick,
  t,
}: {
  mission: MissionListItem;
  selected: boolean;
  isFavorite: boolean;
  onClick: () => void;
  t: TFunction;
}) {
  const famKey = mapScopeFamily(mission);
  const fam = FAMILY[famKey];
  const Icon = FAMILY_ICON[famKey] ?? CircleDot;

  return (
    <button
      onClick={onClick}
      className={[
        "flex w-full items-start gap-2.5 rounded-xl border p-2.5 text-left transition-colors",
        selected
          ? "border-accent/60 bg-accent/[0.10]"
          : "border-white/[0.07] bg-white/[0.02] hover:border-accent/30 hover:bg-white/[0.04]",
      ].join(" ")}
    >
      <span
        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
        style={{ background: fam.bg, color: fam.color }}
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-white">{mission.title}</span>
          {isFavorite && <Star className="h-3.5 w-3.5 shrink-0 text-amber-300" fill="currentColor" />}
        </span>
        {mission.factionName && (
          <span className="mt-0.5 block truncate text-[11px] text-white/45">{mission.factionName}</span>
        )}
        <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-white/50">
          {mission.reputationAmount != null && (
            <span className="inline-flex items-center gap-1 tabular-nums">
              <Star className="h-3 w-3 text-amber-300" />+{mission.reputationAmount.toLocaleString("fr-FR")}
            </span>
          )}
          {mission.timeMins != null && (
            <span className="inline-flex items-center gap-1 tabular-nums">
              <Clock className="h-3 w-3" />
              {t("mission.minutes", { count: mission.timeMins })}
            </span>
          )}
          {mission.illegal && (
            <span className="rounded px-1.5 py-0.5 text-[9px] font-medium" style={{ color: "#f87171", background: "rgba(248,113,113,0.16)" }}>
              {t("mission.badgeIllegal")}
            </span>
          )}
          {mission.hasBlueprints && (
            <span className="rounded px-1.5 py-0.5 text-[9px] font-medium text-accent" style={{ background: "color-mix(in oklab, var(--accent) 14%, transparent)" }}>
              {t("mission.badgeLoot")}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}
