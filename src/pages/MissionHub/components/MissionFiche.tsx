import type { TFunction } from "i18next";
import { CircleDot } from "lucide-react";
import { deriveStarRating, renderStars } from "../../../lib/missionStats";
import { FAMILY, FAMILY_ICON, FicheTab, MissionListItem, ScopeWithRanks, mapScopeFamily } from "../helpers";
import { DetailsTab } from "./DetailsTab";
import { DropTab } from "./DropTab";

/* ─────────────────────────── Fiche mission (droite) ─────────────────────────── */

export function MissionFiche({
  mission,
  missions,
  scopes,
  accountId,
  ficheTab,
  setFicheTab,
  isObjective,
  isFavorite,
  onToggleObjective,
  onToggleFavorite,
  onOpenBlueprint,
  t,
}: {
  mission: MissionListItem;
  missions: MissionListItem[];
  scopes: ScopeWithRanks[];
  accountId: string;
  ficheTab: FicheTab;
  setFicheTab: (tab: FicheTab) => void;
  isObjective: boolean;
  isFavorite: boolean;
  onToggleObjective: () => void;
  onToggleFavorite: () => void;
  onOpenBlueprint: (blueprintId: string) => void;
  t: TFunction;
}) {
  const famKey = mapScopeFamily(mission);
  const fam = FAMILY[famKey];
  const Icon = FAMILY_ICON[famKey] ?? CircleDot;
  const stars = mission.minStandingValue ? renderStars(deriveStarRating(mission.minStandingValue)) : null;

  return (
    <>
      {/* En-tête */}
      <div className="shrink-0 border-b border-white/5 bg-gradient-to-b from-accent/[0.05] to-transparent p-5">
        <div className="flex items-start gap-3">
          <span
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
            style={{ background: fam.bg, color: fam.color }}
          >
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-wider text-accent/70">
              {[mission.factionName, mission.rewardScope].filter(Boolean).join(" · ") || "—"}
            </p>
            <h2 className="mt-1 text-xl font-bold text-white">{mission.title}</h2>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {mission.rewardScope && mission.rewardScope !== "Other" && (
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase"
              style={{ color: fam.color, background: fam.bg, border: `1px solid ${fam.border}` }}
            >
              {mission.rewardScope}
            </span>
          )}
          {mission.illegal && (
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase"
              style={{ color: "#f87171", background: "rgba(248,113,113,0.12)", border: "1px solid rgba(248,113,113,0.3)" }}
            >
              {t("mission.badgeIllegal")}
            </span>
          )}
          {mission.hasBlueprints && (
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase"
              style={{ color: "var(--accent)", background: "color-mix(in oklab, var(--accent) 12%, transparent)", border: "1px solid color-mix(in oklab, var(--accent) 30%, transparent)" }}
            >
              {t("mission.badgeLoot")}
            </span>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/60">
          {mission.reputationAmount != null && (
            <span className="font-semibold text-accent">
              +{mission.reputationAmount.toLocaleString("fr-FR")} {t("mission.repSuffix")}
            </span>
          )}
          {mission.timeMins != null && <span>· {t("mission.minutes", { count: mission.timeMins })}</span>}
          {stars && <span>· {stars}</span>}
        </div>
      </div>

      {/* Onglets */}
      <div className="flex shrink-0 gap-5 border-b border-white/5 px-5">
        {(["details", "drop"] as FicheTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setFicheTab(tab)}
            className={[
              "border-b-2 py-2.5 text-sm transition-colors",
              ficheTab === tab
                ? "border-accent font-semibold text-accent"
                : "border-transparent text-white/55 hover:text-white/80",
            ].join(" ")}
          >
            {tab === "details" ? t("mission.tabDetails") : t("mission.tabDrop")}
          </button>
        ))}
      </div>

      {/* Corps onglet */}
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {ficheTab === "details" ? (
          <DetailsTab
            mission={mission}
            missions={missions}
            scopes={scopes}
            accountId={accountId}
            isObjective={isObjective}
            isFavorite={isFavorite}
            onToggleObjective={onToggleObjective}
            onToggleFavorite={onToggleFavorite}
            t={t}
          />
        ) : (
          <DropTab mission={mission} onOpenBlueprint={onOpenBlueprint} t={t} />
        )}
      </div>
    </>
  );
}
