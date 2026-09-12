// Carnet de bord (refonte) — vue d'ensemble façon dashboard : KPI, dernière session +
// streak, heatmap d'activité, tops véhicules/lieux, dépenses par boutique, bulles systèmes.
// Données : get_journal_overview (agrégats). DA SC Fleet (tokens theme.css, lucide, i18n).

import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { Loader2, RefreshCw, ScrollText } from "lucide-react";
import type { Overview, Period } from "./types";
import { fmtCompact, fmtHours, prettyVehicle } from "./helpers";
import { KpiStrip } from "./components/KpiStrip";
import { LastSessionStreak } from "./components/LastSessionStreak";
import { ActivityHeatmap } from "./components/ActivityHeatmap";
import { StatBars } from "./components/StatBars";
import { SystemBubbles } from "./components/SystemBubbles";

const PERIODS: Period[] = [30, 90, null];

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-white/10 bg-white/[0.03] p-4 ${className}`}>
      {children}
    </section>
  );
}

function CardTitle({ title, extra }: { title: string; extra?: string }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <span className="text-[12px] font-semibold uppercase tracking-[0.13em] text-white/50">{title}</span>
      {extra && <span className="text-[11px] text-white/35">{extra}</span>}
    </div>
  );
}

export default function JournalPage() {
  const { t } = useTranslation();
  const [period, setPeriod] = useState<Period>(null);
  const [ov, setOv] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (days: Period) => {
    setLoading(true);
    try {
      const data = await invoke<Overview>("get_journal_overview", { days });
      setOv(data);
    } catch {
      setOv(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(period);
  }, [period, load]);

  async function resync() {
    if (busy) return;
    setBusy(true);
    try {
      await invoke("replay_gamelog");
      await load(period);
    } catch {
      /* best-effort */
    } finally {
      setBusy(false);
    }
  }

  const hasData =
    ov != null && (ov.playtime.totalSeconds > 0 || ov.heatmap.length > 0 || ov.missions.completed > 0);

  return (
    <div className="p-8">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-white/40">{t("journal.ovEyebrow")}</p>
          <h1 className="text-2xl font-bold text-white">{t("journal.title")}</h1>
          {ov?.character && (
            <p className="mt-1 text-[13px] text-white/45">
              <span className="font-semibold text-white/80">{ov.character}</span>
              {ov.playtime.totalSeconds > 0 &&
                ` · ${t("journal.ovSessionsCount", { count: ov.playtime.sessions })}`}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2.5">
          <div className="inline-flex gap-1 rounded-xl border border-white/10 bg-white/5 p-1">
            {PERIODS.map((p) => (
              <button
                key={String(p)}
                onClick={() => setPeriod(p)}
                aria-pressed={period === p}
                className={[
                  "rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors",
                  period === p ? "bg-[var(--accent-muted)] text-[var(--accent)]" : "text-white/50 hover:text-white/90",
                ].join(" ")}
              >
                {p == null ? t("journal.ovPeriodAll") : t("journal.ovPeriodDays", { count: p })}
              </button>
            ))}
          </div>
          <button
            onClick={() => void resync()}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3.5 py-2 text-[12.5px] font-medium text-white/70 transition-colors hover:bg-white/10 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {t("journal.ovSync")}
          </button>
        </div>
      </header>

      {loading ? (
        <div className="flex items-center gap-2 text-white/50">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("journal.ovLoading")}
        </div>
      ) : !hasData || !ov ? (
        <div className="rounded-2xl border border-dashed border-white/15 bg-white/5 p-12 text-center">
          <ScrollText className="mx-auto mb-3 h-8 w-8 text-white/25" />
          <p className="text-white/70">{t("journal.ovEmpty")}</p>
          <p className="mx-auto mt-2 max-w-md text-[13px] text-white/40">{t("journal.ovEmptyHint")}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3.5">
          <KpiStrip ov={ov} t={t} />

          <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-12">
            <Card className="lg:col-span-4">
              <LastSessionStreak ov={ov} t={t} />
            </Card>
            <Card className="lg:col-span-8">
              <ActivityHeatmap data={ov.heatmap} t={t} />
            </Card>

            <Card className="lg:col-span-6">
              <CardTitle title={t("journal.ovTopVehicles")} extra={t("journal.ovByHours")} />
              <StatBars
                empty={t("journal.ovEmptyList")}
                rows={ov.topVehicles.map((v) => ({
                  name: prettyVehicle(v.name),
                  value: v.seconds,
                  valueLabel: fmtHours(v.seconds),
                  sub: t("journal.ovSessionsN", { count: v.sessions }),
                }))}
              />
            </Card>
            <Card className="lg:col-span-6">
              <CardTitle title={t("journal.ovTopLocations")} extra={t("journal.ovByHours")} />
              <StatBars
                empty={t("journal.ovEmptyList")}
                rows={ov.topLocations.map((l) => ({
                  name: l.name,
                  value: l.seconds,
                  valueLabel: fmtHours(l.seconds),
                  sub: t("journal.ovVisitsN", { count: l.visits }),
                }))}
              />
            </Card>

            <Card className="lg:col-span-8">
              <CardTitle title={t("journal.ovSpending")} />
              <div className="mb-4 flex items-baseline gap-2">
                <b className="text-[26px] font-bold tabular-nums text-white">{fmtCompact(ov.spendingTotal)}</b>
                <span className="text-[12.5px] text-white/50">
                  {t("journal.ovSpentUnit", { count: ov.spendingCount })}
                </span>
              </div>
              <StatBars
                color="var(--amber)"
                empty={t("journal.ovEmptyList")}
                rows={ov.spendingByShop.map((s) => ({
                  name: s.shop,
                  value: s.spent,
                  valueLabel: fmtCompact(s.spent),
                }))}
              />
            </Card>
            <Card className="lg:col-span-4">
              <CardTitle title={t("journal.ovSystems")} extra={t("journal.ovByHours")} />
              <SystemBubbles systems={ov.systems} empty={t("journal.ovEmptyList")} />
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
