import { useTranslation } from "react-i18next";
import type { Journal } from "../useHomeData";

const fmtDur = (s: number) => `${Math.floor(s / 3600)} h ${String(Math.round((s % 3600) / 60)).padStart(2, "0")}`;

/* Carnet de bord (agrégats du Game.log). */
export function LogbookCard({ journal, onOpen }: { journal: Journal; onOpen: () => void }) {
  const { t } = useTranslation();
  return (
    <section className="glass flex flex-col gap-2 rounded-2xl px-4 py-3" style={{ background: "rgba(20,20,32,0.34)" }}>
      <header className="flex items-center text-[10.5px] font-bold uppercase tracking-[0.1em] text-white/60">
        {t("home.logbook")}
        <button type="button" onClick={onOpen} className="ml-auto text-[11.5px] font-semibold normal-case tracking-normal text-indigo-300">
          {t("home.seeAll")}
        </button>
      </header>
      {journal.lastSession && (
        <Row label={t("home.lastSession")} value={fmtDur(journal.lastSession.durationSeconds)} />
      )}
      <Row label={t("home.spending")} value={`${Math.round(journal.spendingTotal).toLocaleString("fr-FR")} aUEC`} />
      <Row label={t("home.missionsDone")} value={String(journal.missions.completed)} />
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2.5 text-[12.5px] text-white/60">
      <span>{label}</span>
      <b className="whitespace-nowrap font-semibold tabular-nums text-white">{value}</b>
    </div>
  );
}
