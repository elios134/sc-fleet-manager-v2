import { type TFunction } from "i18next";
import { type MissionListItem } from "../../missionShared";
import { formatAuec } from "../helpers";

/* ── Missions recommandées : top 3 par récompense brute ── */

function MissionsBody({
  missions,
  t,
  editing,
  onOpen,
}: {
  missions: MissionListItem[];
  t: TFunction;
  editing: boolean;
  onOpen: (m: MissionListItem) => void;
}) {
  if (missions.length === 0) {
    return (
      <div className="flex min-h-[120px] items-center justify-center text-xs text-white/40">
        {t("dashboard.wMissionsNone")}
      </div>
    );
  }
  return (
    <div>
      {missions.map((m) => (
        <div
          key={m.uuid}
          // Clic ligne → ouvre la modale de la mission DANS le dashboard (hors édition).
          onClick={editing ? undefined : () => onOpen(m)}
          className={`border-b border-white/5 py-2 last:border-0 ${
            editing ? "" : "cursor-pointer transition-colors hover:bg-white/[0.03]"
          }`}
        >
          <div className="truncate text-[13px] font-medium text-white">{m.title}</div>
          <div className="mt-0.5 flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-[11px] text-white/40">
              {m.factionName ?? "—"}
            </span>
            <span className="shrink-0 text-[11px] font-semibold text-[#5dcaa5]">
              {t("dashboard.aUec", { amount: formatAuec(m.rewardMax ?? 0) })}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

export { MissionsBody };
