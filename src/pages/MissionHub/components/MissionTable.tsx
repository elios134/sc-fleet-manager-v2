import type { TFunction } from "i18next";
import { Star } from "lucide-react";
import type { MissionListItem } from "../helpers";

const th = "whitespace-nowrap border-b border-white/[0.06] px-2.5 py-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-white/40";
const td = "border-b border-white/[0.06] px-2.5 py-1.5 text-[12px] text-white/60";
const pill = "shrink-0 rounded-full border px-1.5 py-px text-[9.5px] font-semibold uppercase";

/** Récompense : « 16 000 » ou « 8 000 – 16 000 » si elle varie ; « — » inconnue. */
function reward(m: MissionListItem): string {
  const fmt = (n: number) => n.toLocaleString("fr-FR");
  if (m.rewardMax == null) return "—";
  return m.rewardMin != null && m.rewardMin !== m.rewardMax ? `${fmt(m.rewardMin)} – ${fmt(m.rewardMax)}` : fmt(m.rewardMax);
}

/** Tableau des missions : clic sur une ligne → fiche à droite. */
export function MissionTable({
  missions,
  selectedUuid,
  favorites,
  onSelect,
  t,
}: {
  missions: MissionListItem[];
  selectedUuid: string | null;
  favorites: Set<string>;
  onSelect: (m: MissionListItem) => void;
  t: TFunction;
}) {
  return (
    <table className="w-full border-collapse text-left">
      <thead>
        <tr>
          <th className={th}>{t("mission.colMission")}</th>
          <th className={th}>{t("mission.colFaction")}</th>
          <th className={th}>{t("mission.colSystem")}</th>
          <th className={`${th} text-right`}>{t("mission.colReward")}</th>
          <th className={`${th} text-right`}>{t("mission.colDuration")}</th>
          <th className={`${th} text-right`}>{t("mission.colRep")}</th>
        </tr>
      </thead>
      <tbody>
        {missions.map((m) => {
          const sel = m.uuid === selectedUuid;
          return (
            <tr
              key={m.uuid}
              onClick={() => onSelect(m)}
              aria-selected={sel}
              className={`cursor-pointer transition-colors ${sel ? "bg-[var(--accent-muted)] shadow-[inset_3px_0_0_var(--accent)]" : "hover:bg-white/[0.03]"}`}
            >
              <td className="border-b border-white/[0.06] px-2.5 py-1.5">
                <span className="flex min-w-0 items-center gap-1.5">
                  {favorites.has(m.uuid) && <Star className="h-3.5 w-3.5 shrink-0 text-[var(--warning)]" fill="currentColor" />}
                  <span className="truncate text-[13px] font-semibold text-white">{m.title}</span>
                  {m.illegal && <span className={`${pill} border-[var(--danger)]/40 text-[var(--danger)]`}>{t("mission.badgeIllegal")}</span>}
                  {m.hasBlueprints && <span className={`${pill} border-[var(--accent)]/50 text-white`}>{t("mission.badgeLoot")}</span>}
                </span>
              </td>
              <td className={`${td} max-w-[180px] truncate`}>{m.factionName ?? "—"}</td>
              <td className={`${td} max-w-[120px] truncate`}>{m.starSystems ?? "—"}</td>
              <td className={`${td} whitespace-nowrap text-right tabular-nums text-white/80`}>{reward(m)}</td>
              <td className={`${td} whitespace-nowrap text-right tabular-nums`}>{m.timeMins != null ? t("mission.minutes", { count: m.timeMins }) : "—"}</td>
              <td className={`${td} whitespace-nowrap text-right tabular-nums`}>{m.reputationAmount != null ? `+${m.reputationAmount.toLocaleString("fr-FR")}` : "—"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
