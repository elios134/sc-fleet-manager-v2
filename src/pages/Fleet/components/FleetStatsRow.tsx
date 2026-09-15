import { Coins, Rocket, ShieldCheck, Clock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatUsd } from "../helpers";
import type { FleetStats } from "../types";

interface Props {
  stats: FleetStats;
  shipCount: number;
}

/* Héro de synthèse de la flotte : valeur totale, nombre de vaisseaux, actifs LTI, et surtout
   la prochaine assurance à expirer (remontée en rouge — l'info la plus actionnable). */
export default function FleetStatsRow({ stats, shipCount }: Props) {
  const { t } = useTranslation();
  const exp = stats.nextExpiry;
  const urgent = exp != null && exp.daysRemaining <= 14;
  return (
    <div className="mb-[18px] grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1.3fr]">
      <StatTile icon={<Coins className="h-3.5 w-3.5" />} label={t("fleet.statTotalValue2")} accent="value">
        <span className="text-white">{formatUsd(stats.totalFleetValueUsd)}</span>
      </StatTile>
      <StatTile icon={<Rocket className="h-3.5 w-3.5" />} label={t("fleet.statShips")}>
        {shipCount}
      </StatTile>
      <StatTile icon={<ShieldCheck className="h-3.5 w-3.5" />} label={t("fleet.statLtiAssets2")} accent="lti">
        <span className="text-[#2ee9a5]">{stats.ltiAssetsCount}</span>
      </StatTile>
      <StatTile icon={<Clock className="h-3.5 w-3.5" />} label={t("fleet.statNextExpiry2")} accent={urgent ? "exp" : undefined}>
        {exp ? (
          <span className="flex items-baseline gap-2">
            <span className={urgent ? "text-[#f26d6d]" : "text-white"}>{t("fleet.daysShort", { days: exp.daysRemaining })}</span>
            <span className="truncate text-xs font-semibold normal-case tracking-normal text-white/55">{exp.shipName}</span>
          </span>
        ) : (
          <span className="text-white/45">{t("fleet.none")}</span>
        )}
      </StatTile>
    </div>
  );
}

function StatTile({
  icon,
  label,
  accent,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  accent?: "value" | "lti" | "exp";
  children: React.ReactNode;
}) {
  const bg =
    accent === "value"
      ? "linear-gradient(135deg,rgba(99,102,241,0.18),rgba(99,102,241,0.04))"
      : accent === "exp"
        ? "linear-gradient(135deg,rgba(242,109,109,0.14),transparent)"
        : "rgba(255,255,255,0.045)";
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 px-4 py-3.5" style={{ background: bg }}>
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.14em] text-white/40">
        {icon}
        {label}
      </div>
      <div className="mt-2 text-[26px] font-bold leading-none tabular-nums">{children}</div>
    </div>
  );
}
