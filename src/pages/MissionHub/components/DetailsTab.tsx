import { useMemo, useState } from "react";
import type { TFunction } from "i18next";
import { Star, Target } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import StatCard from "../../../components/ui/StatCard";
import { formatRewardRange, calculateUecPerHour, formatUecPerHourCompact } from "../../../lib/missionStats";
import { MissionListItem, ScopeWithRanks, computeRepeatsNeeded, computeTotalFarmTime, findOptimalMission, isCleanDescription, mapRewardScopeToScopeName } from "../helpers";
import { ReputationPanel, Section } from "./ReputationPanel";

/* ── Onglet Détails (ancienne modale + reco de farm) ── */

export function DetailsTab({
  mission,
  missions,
  scopes,
  accountId,
  isObjective,
  isFavorite,
  onToggleObjective,
  onToggleFavorite,
  t,
}: {
  mission: MissionListItem;
  missions: MissionListItem[];
  scopes: ScopeWithRanks[];
  accountId: string;
  isObjective: boolean;
  isFavorite: boolean;
  onToggleObjective: () => void;
  onToggleFavorite: () => void;
  t: TFunction;
}) {
  const [declaredRep, setDeclaredRep] = useState<number | null>(null);
  const uecPerHour = calculateUecPerHour(mission);
  const showDesc = isCleanDescription(mission.description);
  const wikiUrl = mission.webUrl ?? `https://star-citizen.wiki/Mission/${mission.uuid}`;

  // Prérequis (verdict comparé à la réputation déclarée).
  const reqValue = mission.minStandingValue;
  const hasPrereq = reqValue != null && reqValue > 0;
  const declared = declaredRep ?? 0;
  const scopeName = mapRewardScopeToScopeName(mission.rewardScope);
  const hasScope = !!(scopeName && scopes.some((s) => s.scopeName === scopeName));
  const reqMet = hasPrereq && declared >= (reqValue as number);
  const remaining = hasPrereq ? Math.max(0, (reqValue as number) - declared) : 0;

  // Reco de farm (même faction, meilleur ratio rep/min).
  const optimal = useMemo(
    () => findOptimalMission(missions, mission.factionUuid),
    [missions, mission.factionUuid],
  );
  const perRun = optimal?.reputationAmount ?? 0;
  const repeats = optimal ? computeRepeatsNeeded(reqValue ?? 0, declared, perRun) : 0;
  const totalFarmHours = computeTotalFarmTime(repeats, optimal?.timeMins ?? 0) / 60;

  return (
    <>
      {/* Statistiques */}
      <Section title={t("mission.statistics")}>
        <div className="grid grid-cols-3 gap-2">
          <StatCard label={t("mission.reward")} value={formatRewardRange(mission)} caption={t("mission.auec")} variant="gold" />
          <StatCard
            label={t("mission.repXp")}
            value={mission.reputationAmount != null ? mission.reputationAmount.toLocaleString("fr-FR") : "—"}
            caption={t("mission.perRun")}
          />
          <StatCard
            label={t("mission.efficiency")}
            value={formatUecPerHourCompact(uecPerHour)}
            caption={t("mission.auecPerHour")}
            variant={uecPerHour != null ? "gold" : "neutral"}
          />
        </div>
      </Section>

      {/* Prérequis */}
      <Section title={t("mission.prereq")}>
        {!hasPrereq ? (
          <p className="text-sm italic text-white/40">{t("mission.noPrereq")}</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-white/80">
              🔒 {mission.factionName ? `${mission.factionName} : ` : ""}
              <strong className="text-white">{mission.minStandingName ?? "—"}</strong> (
              {t("mission.repParen", { rep: (reqValue as number).toLocaleString("fr-FR") })})
            </span>
            {!hasScope ? (
              <span className="text-xs italic text-white/40">{t("mission.repNotTracked")}</span>
            ) : reqMet ? (
              <span
                className="rounded-full px-2 py-0.5 text-xs font-semibold"
                style={{ color: "#34d399", background: "rgba(52,211,153,0.12)", border: "1px solid rgba(52,211,153,0.30)" }}
              >
                {t("mission.prereqMet")}
              </span>
            ) : (
              <span className="text-xs text-accent">
                {t("mission.repStillNeeded", { rep: remaining.toLocaleString("fr-FR") })}
              </span>
            )}
          </div>
        )}
      </Section>

      {/* Réputation déclarée + progression de grade */}
      <Section title={t("mission.reputation")}>
        <ReputationPanel
          rewardScope={mission.rewardScope}
          accountId={accountId}
          scopes={scopes}
          onReputation={setDeclaredRep}
        />
      </Section>

      {/* Recommandation de farm */}
      <Section title={t("mission.bestFarmMission")}>
        {!optimal ? (
          <p className="text-sm italic text-white/40">{t("mission.noMissionForFaction")}</p>
        ) : (
          <div
            className="rounded-xl border px-3 py-2.5"
            style={{ borderColor: "color-mix(in oklab, var(--accent) 25%, transparent)", background: "color-mix(in oklab, var(--accent) 6%, transparent)" }}
          >
            <p className="text-sm font-medium text-white">{optimal.title}</p>
            <p className="mt-0.5 text-xs text-white/70">
              {t("mission.farmLine", {
                rep: (optimal.reputationAmount ?? 0).toLocaleString("fr-FR"),
                min: optimal.timeMins,
              })}
              {repeats > 0 && (
                <>
                  {" · "}
                  {t("mission.farmRepeats", {
                    repeats,
                    hours: totalFarmHours.toLocaleString("fr-FR", { maximumFractionDigits: 1 }),
                  })}
                </>
              )}
            </p>
            {repeats === 0 && hasPrereq && (
              <p className="mt-1 text-xs font-semibold" style={{ color: "#34d399" }}>
                {t("mission.objectiveReached")}
              </p>
            )}
          </div>
        )}
      </Section>

      {/* Description */}
      {showDesc && (
        <Section title={t("mission.description")}>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-white/70">{mission.description}</p>
        </Section>
      )}

      {/* Actions */}
      <div className="mt-6 flex flex-wrap gap-2">
        <button
          onClick={onToggleObjective}
          className={[
            "flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-colors",
            isObjective ? "border text-[#60a5fa]" : "border border-white/10 bg-white/5 text-white/80 hover:bg-white/10",
          ].join(" ")}
          style={isObjective ? { borderColor: "rgba(96,165,250,0.35)", background: "rgba(96,165,250,0.12)" } : undefined}
        >
          <Target className="h-4 w-4" />
          {isObjective ? t("mission.objectiveTracked") : t("mission.addObjective")}
        </button>
        <button
          onClick={onToggleFavorite}
          className={[
            "flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-colors",
            isFavorite ? "border text-accent" : "border border-white/10 bg-white/5 text-white/80 hover:bg-white/10",
          ].join(" ")}
          style={isFavorite ? { borderColor: "color-mix(in oklab, var(--accent) 35%, transparent)", background: "color-mix(in oklab, var(--accent) 12%, transparent)" } : undefined}
        >
          <Star className="h-4 w-4" fill={isFavorite ? "currentColor" : "none"} />
          {t("mission.favorite")}
        </button>
        <button
          onClick={() => void openUrl(wikiUrl)}
          className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white/70 transition-colors hover:bg-white/10"
        >
          {t("mission.viewWiki")}
        </button>
      </div>
    </>
  );
}
