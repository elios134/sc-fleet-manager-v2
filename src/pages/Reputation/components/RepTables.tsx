import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { FactionRep } from "../../../lib/reputation";

const TH = "whitespace-nowrap border-b border-white/[0.06] px-2.5 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-white/40";
const TD = "border-b border-white/[0.06] px-2.5 py-2.5";

/** Onglets « Missions conseillées » et « Journal » de la fiche. */
export function RepTables({ f }: { f: FactionRep }) {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState<"advice" | "journal">("advice");
  const max = Math.max(1, ...f.advice.map((a) => a.perHour));
  const n = (v: number) => v.toLocaleString(i18n.language);
  const when = (iso: string) => new Date(iso).toLocaleString(i18n.language, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const tabBtn = (k: typeof tab, label: string) => (
    <button
      type="button"
      onClick={() => setTab(k)}
      className={`rounded-full px-3 py-1.5 text-[12.5px] font-semibold ${tab === k ? "bg-white/[0.08] text-white" : "text-white/55 hover:text-white"}`}
    >
      {label}
    </button>
  );
  return (
    <section className="glass mt-3.5 rounded-[18px] px-5 py-[18px]">
      <div className="mb-3 flex gap-1">
        {tabBtn("advice", t("reputation.tabAdvice"))}
        {tabBtn("journal", t("reputation.tabJournal", { count: f.journal.length }))}
      </div>
      <div className="overflow-x-auto">
        {tab === "advice" && f.advice.length === 0 && <p className="py-3 text-sm text-white/50">{t("reputation.noAdvice")}</p>}
        {tab === "advice" && f.advice.length > 0 && (
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className={TH}>{t("reputation.colMission")}</th>
                <th className={`${TH} text-right`}>{t("reputation.colRep")}</th>
                <th className={`${TH} text-right`}>{t("reputation.colDuration")}</th>
                <th className={TH}>{t("reputation.colPerHour")}</th>
              </tr>
            </thead>
            <tbody>
              {f.advice.map((a) => (
                <tr key={a.title}>
                  <td className={`${TD} font-semibold text-white`}>{a.title}</td>
                  <td className={`${TD} text-right tabular-nums`}>+{n(a.amount)}</td>
                  <td className={`${TD} whitespace-nowrap text-right tabular-nums text-white/55`}>{t("reputation.minutes", { count: a.timeMins })}</td>
                  <td className={TD}>
                    <span className="inline-flex items-center gap-2">
                      <i className="inline-block h-[5px] rounded-full bg-[var(--live)]/80" style={{ width: `${Math.round((a.perHour / max) * 90)}px` }} />
                      <span className="tabular-nums">{n(a.perHour)}</span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === "journal" && (
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className={TH}>{t("reputation.colWhen")}</th>
                <th className={TH}>{t("reputation.colMission")}</th>
                <th className={`${TH} text-right`}>{t("reputation.colRep")}</th>
                <th className={TH}>{t("reputation.colLoot")}</th>
              </tr>
            </thead>
            <tbody>
              {f.journal.map((j) => (
                <tr key={`${j.at}-${j.title}`}>
                  <td className={`${TD} whitespace-nowrap tabular-nums text-white/55`}>{when(j.at)}</td>
                  <td className={`${TD} font-semibold text-white`}>{j.title}</td>
                  <td className={`${TD} text-right font-bold tabular-nums text-[var(--success)]`}>+{n(j.amount)}</td>
                  <td className={`${TD} text-white/55`}>{j.loot.length ? j.loot.join(", ") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {tab === "advice" && f.advice.length > 0 && <p className="mt-2.5 text-xs text-white/50">{t("reputation.adviceHint")}</p>}
    </section>
  );
}
