import { type TFunction } from "i18next";
import { type RsiServerStatus } from "../types";

/* ── Statut serveurs RSI : pastille globale + composants (Phase 0) ── */

// Couleur par code de statut interne (cf. rsi_status.rs).
const RSI_STATUS_COLOR: Record<string, string> = {
  operational: "#34d399",
  degraded: "#fbbf24",
  partial: "#fb923c",
  major: "#f87171",
  maintenance: "#60a5fa",
  unknown: "#9ca3af",
};

function rsiStatusColor(code: string): string {
  return RSI_STATUS_COLOR[code] ?? RSI_STATUS_COLOR.unknown;
}

function RsiStatusBody({
  status,
  t,
}: {
  status: RsiServerStatus | null;
  t: TFunction;
}) {
  if (!status) {
    return (
      <div className="flex min-h-[72px] items-center justify-center text-xs text-white/40">
        {t("dashboard.wRsiStatusUnavailable")}
      </div>
    );
  }
  const color = rsiStatusColor(status.overall);
  // Libellé global : on privilégie une traduction si le code est connu, sinon le brut.
  const overallLabel =
    status.overall !== "unknown"
      ? t(`dashboard.wRsiStatusOverall.${status.overall}`)
      : status.overallLabel || t("dashboard.wRsiStatusUnavailable");
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: color, boxShadow: `0 0 8px ${color}` }}
        />
        <span className="truncate text-[13px] font-semibold text-white">{overallLabel}</span>
      </div>
      <div className="space-y-1">
        {status.components.slice(0, 4).map((c) => (
          <div key={c.name} className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-[11px] text-white/55">{c.name}</span>
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: rsiStatusColor(c.status) }}
              title={c.status}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export { RsiStatusBody };
