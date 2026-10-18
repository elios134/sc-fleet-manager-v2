import { useTranslation } from "react-i18next";
import type { InsuranceRow } from "../../../lib/insurance";
import { kpis, segmentsFilled, timelineEvents } from "../timeline";

const WINDOW = 30;

/* 4 compteurs : couverts (dont LTI), sous 15 j, expirées, prochaine échéance. */
export function Kpis({ rows }: { rows: InsuranceRow[] }) {
  const { t } = useTranslation();
  const k = kpis(rows);
  const cell = (label: string, value: string, sub: string, tone: string) => (
    <div className="glass flex flex-col gap-0.5 rounded-2xl px-4 py-3.5">
      <span className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-white/45">{label}</span>
      <b className={`text-[30px] font-extrabold leading-tight tabular-nums ${tone}`}>{value}</b>
      <small className="text-xs text-white/45">{sub}</small>
    </div>
  );
  return (
    <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cell(t("insurance.kpiCovered"), String(k.covered), t("insurance.kpiCoveredSub", { n: k.lti }), "text-indigo-200")}
      {cell(t("insurance.kpiSoon"), String(k.soon), t("insurance.kpiSoonSub"), "text-amber-300")}
      {cell(t("insurance.kpiExpired"), String(k.expired), t("insurance.kpiExpiredSub"), "text-red-300")}
      {cell(t("insurance.kpiNext"), k.nextDays == null ? "—" : t("insurance.inDays", { n: k.nextDays }), t("insurance.kpiNextSub"), "text-white")}
    </div>
  );
}

const TONE = {
  bad: "border-red-400/45 text-red-300",
  warn: "border-[var(--amber)]/45 text-amber-300",
  ok: "border-emerald-400/40 text-emerald-300",
} as const;
const LINE = { bad: "bg-red-400", warn: "bg-[var(--amber)]", ok: "bg-emerald-400" } as const;

/* Frise des 30 prochains jours : zones rouge / ambre, étiquettes alternées haut/bas. */
export function ExpiryTimeline({ rows }: { rows: InsuranceRow[] }) {
  const { t } = useTranslation();
  const ev = timelineEvents(rows, WINDOW);
  if (ev.length === 0) return null;
  const ticks = [0, 10, 20, 30].map((d) => {
    const date = new Date(Date.now() + d * 86_400_000);
    return { pct: (d / WINDOW) * 100, label: `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}` };
  });
  return (
    <section className="glass mb-4 rounded-2xl px-5 pb-5 pt-3.5">
      <p className="flex items-center gap-2.5 text-xs font-bold uppercase tracking-[0.08em] text-white/60">
        {t("insurance.next30")}<span className="h-px flex-1 bg-white/10" />
      </p>
      <div className="relative mt-2.5 h-28">
        <div className="absolute top-[60px] h-[26px] rounded-lg bg-red-400/15" style={{ left: 0, width: "3%" }} />
        <div className="absolute top-[60px] h-[26px] rounded-lg bg-[var(--amber)]/10" style={{ left: "3%", width: `${(15 / WINDOW) * 100 - 3}%` }} />
        <div className="absolute inset-x-0 top-[72px] h-0.5 rounded bg-white/15" />
        <div className="absolute bottom-[26px] left-0 top-[54px] w-0.5 rounded bg-indigo-200 shadow-[0_0_10px_var(--accent)]">
          <b className="absolute -bottom-[18px] left-1.5 whitespace-nowrap text-[10.5px] text-indigo-200">{t("insurance.today")}</b>
        </div>
        {ev.map((e, i) => {
          const first = e.pct < 4;
          const up = i % 2 === 0;
          return (
            <div
              key={e.shipId}
              className="absolute flex flex-col items-center"
              style={{ left: `${e.pct}%`, top: up ? 0 : 22, transform: first ? "none" : "translateX(-50%)", alignItems: first ? "flex-start" : "center" }}
            >
              <span className={`whitespace-nowrap rounded-full border bg-[rgba(20,20,32,0.7)] px-2.5 py-0.5 text-[11.5px] font-semibold ${TONE[e.tone]}`}>
                {e.label} · {e.tone === "bad" ? t("insurance.expiredShort") : t("insurance.inDays", { n: Math.round((e.pct / 100) * WINDOW) })}
              </span>
              <i className={`w-0.5 rounded ${LINE[e.tone]}`} style={{ height: up ? 46 : 24, marginLeft: first ? 10 : 0 }} />
            </div>
          );
        })}
        {ticks.map((tk) => (
          <span key={tk.pct} className="absolute top-[92px] -translate-x-1/2 text-[11px] tabular-nums text-white/40" style={{ left: `${Math.min(97, Math.max(3, tk.pct))}%` }}>{tk.label}</span>
        ))}
      </div>
    </section>
  );
}

/* Carte d'un vaisseau : statut, jauge 10 segments, échéance, action. */
export function InsuranceCard({ row, onRenew }: { row: InsuranceRow; onRenew: () => void }) {
  const { t } = useTranslation();
  const filled = segmentsFilled(row, 10);
  const expired = !row.lti && row.daysLeft != null && row.daysLeft < 0;
  const soon = !row.lti && row.daysLeft != null && row.daysLeft >= 0 && row.daysLeft <= 15;
  const segColor = row.lti ? "bg-[var(--accent)]" : expired ? "bg-red-400" : soon ? "bg-[var(--amber)]" : "bg-emerald-400";
  const border = expired ? "border-red-400/50" : soon ? "border-[var(--amber)]/45" : "";
  const chip = row.lti
    ? <span className="rounded-full border border-[var(--accent)]/55 bg-[var(--accent)]/20 px-2 py-0.5 text-[11px] font-semibold text-indigo-200">LTI</span>
    : expired
      ? <span className="rounded-full border border-red-400/45 bg-red-400/15 px-2 py-0.5 text-[11px] font-semibold text-red-200">{t("insurance.statusExpiredLabel")}</span>
      : soon
        ? <span className="rounded-full border border-[var(--amber)]/45 bg-[var(--amber-muted)] px-2 py-0.5 text-[11px] font-semibold text-amber-200">{t("insurance.inDays", { n: row.daysLeft })}</span>
        : <span className="rounded-full border border-emerald-400/40 bg-emerald-400/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-200">{t("insurance.statusActiveLabel")}</span>;
  return (
    <article className={`glass flex flex-col gap-2.5 rounded-2xl px-4 py-3.5 ${border}`}>
      <header className="flex items-start gap-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15.5px] font-bold text-white">{row.name}</p>
          <p className="truncate text-xs text-white/45">{row.manufacturer} · {row.typeLabel}</p>
        </div>
        {chip}
      </header>
      <div className="flex gap-[3px]" aria-hidden>
        {Array.from({ length: 10 }, (_, i) => <i key={i} className={`h-[7px] flex-1 rounded-[3px] ${i < filled ? segColor : "bg-white/[0.08]"}`} />)}
      </div>
      <p className="flex items-baseline justify-between text-[12.5px] text-white/60">
        <span>{row.lti ? t("insurance.renew.perpetual") : row.expiryLabel}</span>
        <b className="text-lg text-white tabular-nums">
          {row.lti ? "∞" : row.daysLeft == null ? "—" : row.daysLeft < 0 ? t("insurance.overdueShort", { n: -row.daysLeft }) : t("insurance.inDays", { n: row.daysLeft })}
        </b>
      </p>
      <button
        type="button"
        onClick={onRenew}
        className={`self-start rounded-[10px] px-3 py-1.5 text-[12.5px] font-semibold ${expired ? "bg-[var(--accent)] text-white" : "border border-white/15 bg-white/[0.05] text-white/80 hover:bg-white/10"}`}
      >
        {row.lti ? t("insurance.btnLtiInfo") : t("insurance.btnRenew")}
      </button>
    </article>
  );
}
