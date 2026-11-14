import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { FactionEmblem } from "../../../components/FactionEmblem";
import { factionHue, progressPct } from "../../../lib/reputation";
import type { FactionRep } from "../../../lib/reputation";

/** « Ce que je visais » : progression des factions les plus récemment actives vers leur rang suivant. */
export function GoalsCard({ factions }: { factions: FactionRep[] }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const goals = factions.filter((f) => f.toNext != null).slice(0, 3);
  return (
    <section className="glass mt-4 rounded-[18px] px-5 py-[18px]">
      <h3 className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.16em] text-white/40">{t("resume.goals")}</h3>
      {goals.length === 0 && <p className="text-sm text-white/50">{t("resume.noGoals")}</p>}
      {goals.map((f) => (
        <button
          key={`${f.faction}|${f.scopeId}`}
          type="button"
          onClick={() => navigate("/missions/reputation")}
          className="mt-2 flex w-full items-center gap-3 rounded-[14px] border border-white/[0.09] bg-white/[0.035] p-3 text-left hover:bg-white/[0.06]"
        >
          <FactionEmblem mono={f.monogram} hue={factionHue(f.faction)} />
          <span className="min-w-0 flex-1">
            <span className="flex justify-between gap-2">
              <b className="truncate text-white">{t("resume.goalRank", { faction: f.faction, rank: f.ranks[f.rankIndex + 1]?.name ?? "" })}</b>
              <span className="shrink-0 text-xs tabular-nums text-white/55">{t("resume.goalLeft", { n: (f.toNext ?? 0).toLocaleString(i18n.language) })}</span>
            </span>
            <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-white/[0.08]">
              <i className="block h-full bg-[var(--accent)]" style={{ width: `${Math.max(progressPct(f), 3)}%` }} />
            </span>
          </span>
        </button>
      ))}
    </section>
  );
}
