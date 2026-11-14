import { useTranslation } from "react-i18next";
import { FactionEmblem } from "../../../components/FactionEmblem";
import { factionHue, progressPct } from "../../../lib/reputation";
import type { FactionRep } from "../../../lib/reputation";
import { RankLadder } from "./RankLadder";
import { RankRing } from "./RankRing";

/** En-tête de la fiche : emblème, rang, anneau, échelle, chiffres clés et origine du rang. */
export function FactionHero({ f, onCorrect }: { f: FactionRep; onCorrect: () => void }) {
  const { t, i18n } = useTranslation();
  const pct = progressPct(f);
  const rank = f.ranks[f.rankIndex]?.name ?? "—";
  const next = f.ranks[f.rankIndex + 1]?.name;
  const n = (v: number) => v.toLocaleString(i18n.language);
  const date = (iso: string) => new Date(iso).toLocaleDateString(i18n.language);
  const kpis = [
    { label: t("reputation.kpiGained"), value: `+${n(f.gained)}`, tone: "text-[var(--success)]" },
    { label: t("reputation.kpiMissions"), value: n(f.missions), tone: "text-white" },
    { label: next ? t("reputation.kpiBefore", { rank: next }) : t("reputation.kpiMaxRank"), value: f.toNext != null ? n(f.toNext) : "—", tone: "text-white" },
    { label: t("reputation.kpiLeft"), value: f.missionsLeft != null ? `≈ ${n(f.missionsLeft)}` : "—", tone: "text-white" },
  ];
  const source =
    f.rankSource === "declared" && f.declared
      ? t("reputation.sourceDeclared", { date: date(f.declared.at) })
      : f.deduced
        ? t("reputation.sourceDeduced", { date: date(f.deduced.at), rank: f.deduced.rankName, title: f.deduced.title })
        : t("reputation.sourceUnknown");
  return (
    <section className="glass rounded-[18px] pb-5">
      <div className="flex flex-wrap items-center gap-5 px-6 py-5">
        <FactionEmblem mono={f.monogram} hue={factionHue(f.faction)} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-white/40">
            {f.scopeId === "FactionReputation" ? t("reputation.faction") : f.scopeLabel}
          </p>
          <h1 className="text-2xl font-bold text-white [text-wrap:balance]">{f.faction}</h1>
          <p className="mt-0.5 text-[15px] font-semibold text-[var(--accent-soft)]">
            {rank}
            {f.rankSource !== "declared" ? ` · ${t("reputation.atLeast")}` : ""}
          </p>
        </div>
        <RankRing pct={pct} label={t("reputation.toNextRank")} />
      </div>
      <div className="px-6">
        <RankLadder ranks={f.ranks} rankIndex={f.rankIndex} pct={pct} />
        <div className="mt-[18px] grid grid-cols-2 gap-px overflow-hidden rounded-[14px] bg-white/[0.06] lg:grid-cols-4">
          {kpis.map((k) => (
            <div key={k.label} className="bg-[var(--surface-panel)] px-3.5 py-3">
              <span className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-white/40">{k.label}</span>
              <b className={`mt-0.5 block text-[19px] tabular-nums ${k.tone}`}>{k.value}</b>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2.5 rounded-xl border border-dashed border-white/[0.12] bg-white/[0.03] px-3 py-2.5 text-xs text-white/60">
          <span className="min-w-0 flex-1">{source}</span>
          <button
            type="button"
            onClick={onCorrect}
            className="whitespace-nowrap rounded-[10px] border border-white/15 bg-white/[0.06] px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-white/10"
          >
            {t("reputation.correctBtn")}
          </button>
        </div>
      </div>
    </section>
  );
}
