// Bandeau KPI : temps de jeu, missions ✓/✗, blueprints, véhicule & système favoris.

import type { TFunction } from "i18next";
import { Clock, ClipboardCheck, Layers, Rocket, Globe, type LucideIcon } from "lucide-react";
import type { Overview } from "../types";
import { fmtHours, prettyVehicle } from "../helpers";

function Kpi({
  Icon,
  value,
  sub,
  label,
  hint,
}: {
  Icon: LucideIcon;
  value: React.ReactNode;
  sub?: string;
  label: string;
  hint?: string;
}) {
  return (
    <div className="relative flex min-h-[104px] flex-col gap-1 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-4">
      <span
        className="pointer-events-none absolute inset-x-0 top-0 h-0.5"
        style={{ background: "linear-gradient(90deg, var(--accent), transparent 70%)", opacity: 0.6 }}
      />
      <div className="mb-1.5 grid h-[30px] w-[30px] place-items-center rounded-[9px] bg-[var(--accent-muted)] text-[var(--accent)]">
        <Icon className="h-4 w-4" />
      </div>
      <div className="text-[22px] font-bold leading-tight text-white" title={hint}>
        {value}
        {sub && <small className="ml-1 text-[13px] font-medium text-white/50">{sub}</small>}
      </div>
      <div className="text-[11.5px] text-white/50">{label}</div>
    </div>
  );
}

export function KpiStrip({ ov, t }: { ov: Overview; t: TFunction }) {
  const m = ov.missions;
  const totalMissions = m.completed + m.abandoned + m.failed;
  const rate = totalMissions > 0 ? Math.round((m.completed / totalMissions) * 100) : null;
  return (
    <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-5">
      <Kpi
        Icon={Clock}
        value={<span className="tabular-nums">{fmtHours(ov.playtime.totalSeconds)}</span>}
        label={t("journal.ovPlaytime")}
      />
      <Kpi
        Icon={ClipboardCheck}
        value={<span className="tabular-nums">{m.completed} ✓</span>}
        sub={`/ ${m.failed + m.abandoned} ✗`}
        label={rate != null ? t("journal.ovMissionsRate", { rate }) : t("journal.ovMissions")}
      />
      <Kpi
        Icon={Layers}
        value={<span className="tabular-nums">{ov.blueprintsUnlocked}</span>}
        label={t("journal.ovBlueprints")}
      />
      <Kpi
        Icon={Rocket}
        value={<span className="text-[18px]">{ov.favoriteVehicle ? prettyVehicle(ov.favoriteVehicle.name) : "—"}</span>}
        label={t("journal.ovFavVehicle")}
      />
      <Kpi
        Icon={Globe}
        value={<span className="text-[18px]">{ov.favoriteSystem?.name ?? "—"}</span>}
        label={t("journal.ovFavSystem")}
      />
    </div>
  );
}
