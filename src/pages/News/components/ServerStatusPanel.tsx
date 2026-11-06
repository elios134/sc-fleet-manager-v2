import { useTranslation } from "react-i18next";
import { Server } from "lucide-react";
import { statusColor } from "../lib/news";
import type { RsiServerStatus } from "../types";

/** Fiche fixe : état global des serveurs RSI et de chaque service. */
export function ServerStatusPanel({ status }: { status: RsiServerStatus | null }) {
  const { t } = useTranslation();
  return (
    <div>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-white">
        <Server className="h-4 w-4 text-white/50" /> {t("news.serversTitle")}
      </h2>
      {!status ? (
        <p className="text-sm text-white/40">{t("news.statusUnavailable")}</p>
      ) : (
        <>
          <div className="mb-3 flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: statusColor(status.overall) }} />
            <span className="text-sm font-semibold text-white">
              {status.overall !== "unknown" ? t(`dashboard.wRsiStatusOverall.${status.overall}`) : status.overallLabel || t("news.statusUnavailable")}
            </span>
          </div>
          <div className="flex flex-col">
            {status.components.map((c) => (
              <div key={c.name} className="flex items-center gap-2 border-b border-white/[0.06] py-2 last:border-0">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: statusColor(c.status) }} />
                <span className="flex-1 truncate text-[13px] text-white/70">{c.name}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
