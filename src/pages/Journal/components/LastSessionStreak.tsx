// Carte « Dernière session » + streak (jours d'affilée + record).

import type { TFunction } from "i18next";
import { Flame } from "lucide-react";
import type { Overview } from "../types";
import { fmtDuration, fmtSessionDate, prettyVehicle } from "../helpers";

export function LastSessionStreak({ ov, t }: { ov: Overview; t: TFunction }) {
  const ls = ov.lastSession;
  const parts = [
    ls?.vehicle ? prettyVehicle(ls.vehicle) : null,
    ls?.location ?? null,
  ].filter(Boolean) as string[];
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[12px] font-semibold uppercase tracking-[0.13em] text-white/50">
          {t("journal.ovLastSession")}
        </span>
      </div>
      {ls ? (
        <>
          <div className="text-[20px] font-semibold tabular-nums text-white">
            {fmtSessionDate(ls.date)}
          </div>
          <div className="mt-1 text-[14px] text-white/55">{fmtDuration(ls.durationSeconds)}</div>
          {parts.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-white/45">
              {parts.map((p, i) => (
                <span key={i} className="flex items-center gap-2">
                  {i > 0 && <span className="h-1 w-1 rounded-full bg-white/25" />}
                  {p}
                </span>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="text-[15px] text-white/40">{t("journal.ovNoSession")}</div>
      )}

      <div className="mt-4 flex items-center gap-3 border-t border-white/10 pt-4">
        <div
          className="grid h-11 w-11 flex-none place-items-center rounded-xl text-[var(--amber)]"
          style={{ background: "radial-gradient(circle at 50% 30%, rgba(245,158,11,0.26), rgba(245,158,11,0.05))" }}
        >
          <Flame className="h-6 w-6" />
        </div>
        <div>
          <div className="text-[24px] font-bold leading-none tabular-nums text-white">
            {ov.streak.current}
          </div>
          <div className="text-[12px] text-white/50">{t("journal.ovStreakDays")}</div>
        </div>
        <div className="ml-auto text-right text-[11px] text-white/35">
          {t("journal.ovRecord")}
          <b className="block text-[15px] tabular-nums text-white">
            {t("journal.ovDaysShort", { count: ov.streak.record })}
          </b>
        </div>
      </div>
    </div>
  );
}
