import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CMP_ROWS, type CmpGroup, type CmpResult, type ShipDataRow } from "../compare";

const A = "#8b8ff5";
const B = "var(--rival)";

/* Fiche d'un vaisseau du duel (A indigo, B orange), avec le nombre de critères gagnés. */
export function DuelCard({ side, ship, owned, wins, comparable, children }: { side: "a" | "b"; ship: ShipDataRow; owned: boolean; wins: number; comparable: number; children?: ReactNode }) {
  const { t } = useTranslation();
  const isA = side === "a";
  return (
    <section
      className={`glass flex flex-col gap-2 rounded-2xl px-5 py-4 ${isA ? "" : "items-end text-right"}`}
      style={{ borderColor: isA ? "rgba(99,102,241,0.6)" : "rgba(251,146,60,0.55)", background: isA ? "linear-gradient(135deg, rgba(99,102,241,0.24), var(--glass) 60%)" : "linear-gradient(225deg, rgba(251,146,60,0.18), var(--glass) 60%)" }}
    >
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/45">{ship.manufacturer}</p>
      <p className="text-[26px] font-extrabold leading-none tracking-tight text-white">{ship.name}</p>
      <p className="text-[13px] text-white/60">{[ship.role, ship.size].filter(Boolean).join(" · ")}</p>
      {owned && <span className="rounded-full border border-emerald-400/40 bg-emerald-400/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-200">{t("comparator.inFleet")}</span>}
      {children}
      <p className="mt-auto text-[12.5px] text-white/60">
        <b className="block text-[30px] font-extrabold tabular-nums" style={{ color: isA ? "#c7c9ff" : "#fdba74" }}>{wins}</b>
        {t("comparator.winsOf", { n: comparable })}
      </p>
    </section>
  );
}

const AXES: { key: keyof ShipDataRow; labelKey: string }[] = [
  { key: "radarSpeed", labelKey: "comparator.radar.speed" },
  { key: "radarFirepower", labelKey: "comparator.radar.firepower" },
  { key: "radarDefense", labelKey: "comparator.radar.defense" },
  { key: "radarRange", labelKey: "comparator.radar.range" },
  { key: "radarAgility", labelKey: "comparator.radar.agility" },
  { key: "radarUtility", labelKey: "comparator.radar.utility" },
];

/* Radar 6 axes à partir des scores déjà calculés par l'app (radarSpeed…), A et B superposés. */
export function DuelRadar({ a, b }: { a: ShipDataRow; b: ShipDataRow }) {
  const { t } = useTranslation();
  const R = 80;
  const max = Math.max(100, ...AXES.flatMap((ax) => [Number(a[ax.key]) || 0, Number(b[ax.key]) || 0]));
  const pt = (i: number, v: number) => {
    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / AXES.length;
    return [Math.cos(ang) * R * v, Math.sin(ang) * R * v] as const;
  };
  const poly = (s: ShipDataRow) => AXES.map((ax, i) => pt(i, (Number(s[ax.key]) || 0) / max).join(",")).join(" ");
  const ring = (k: number) => AXES.map((_, i) => pt(i, k).join(",")).join(" ");
  return (
    <section className="glass flex flex-col items-center justify-center rounded-2xl p-2">
      <svg viewBox="-125 -112 250 224" className="w-full max-w-[270px]" role="img" aria-label={t("comparator.radarLabel")}>
        <g fill="none" stroke="rgba(255,255,255,0.12)">
          {[1, 2 / 3, 1 / 3].map((k) => <polygon key={k} points={ring(k)} />)}
          {AXES.map((_, i) => { const [x, y] = pt(i, 1); return <line key={i} x1={0} y1={0} x2={x} y2={y} />; })}
        </g>
        <polygon points={poly(a)} fill="rgba(99,102,241,0.25)" stroke={A} strokeWidth={2} strokeLinejoin="round" />
        <polygon points={poly(b)} fill="rgba(251,146,60,0.18)" stroke="#fb923c" strokeWidth={2} strokeLinejoin="round" />
        {AXES.map((ax, i) => {
          const [x, y] = pt(i, 1.2);
          return <text key={ax.key} x={x} y={y + 3} textAnchor="middle" fontSize="10.5" fill="rgba(255,255,255,0.62)">{t(ax.labelKey)}</text>;
        })}
      </svg>
      <div className="flex gap-4 pb-2 text-[11.5px] text-white/60">
        <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-[3px]" style={{ background: A }} />{a.name}</span>
        <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-[3px]" style={{ background: B }} />{b.name}</span>
      </div>
    </section>
  );
}

const GROUPS: CmpGroup[] = ["vol", "combat", "logistique", "discretion"];

/* Barres en miroir par thème, gagnant marqué ▲ (« le plus bas gagne » signalé). */
export function MirrorRows({ rows }: { rows: CmpResult[] }) {
  const { t } = useTranslation();
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return (
    <section className="glass rounded-2xl pb-3 pt-1">
      {GROUPS.map((g) => (
        <div key={g}>
          <p className="flex items-center gap-2.5 px-5 pb-1 pt-3 text-[11px] font-bold uppercase tracking-[0.08em] text-white/60">
            {t(`comparator.group.${g}`)}<span className="h-px flex-1 bg-white/10" />
          </p>
          {CMP_ROWS.filter((d) => d.group === g).map((d) => {
            const r = byKey.get(d.key);
            if (!r || (r.a == null && r.b == null)) return null;
            return (
              <div key={d.key} className="grid grid-cols-1 items-center gap-2 px-5 py-1.5 hover:bg-white/[0.03] md:grid-cols-[minmax(0,1fr)_170px_minmax(0,1fr)] md:gap-3.5">
                <Side value={r.a == null ? "—" : d.fmt(r.a)} ratio={r.ratioA} win={r.winner === "a"} side="a" />
                <p className="order-first text-center text-[12.5px] text-white/60 md:order-none">
                  {t(d.labelKey)}
                  {d.lowerIsBetter && <small className="block text-[10.5px] text-white/40">{t("comparator.lowerWins")}</small>}
                </p>
                <Side value={r.b == null ? "—" : d.fmt(r.b)} ratio={r.ratioB} win={r.winner === "b"} side="b" />
              </div>
            );
          })}
        </div>
      ))}
    </section>
  );
}

function Side({ value, ratio, win, side }: { value: string; ratio: number; win: boolean; side: "a" | "b" }) {
  const isA = side === "a";
  return (
    <div className={`flex items-center gap-2.5 ${isA ? "flex-row-reverse" : ""}`}>
      <span className={`min-w-[96px] text-[13px] tabular-nums ${isA ? "text-right" : ""} ${win ? "font-bold text-white" : "text-white/45"}`}>
        {win && isA && <span className="mr-1 text-[9px] text-indigo-300">▲</span>}{value}{win && !isA && <span className="ml-1 text-[9px] text-orange-300">▲</span>}
      </span>
      <span className={`flex h-2 flex-1 overflow-hidden rounded-full bg-white/[0.06] ${isA ? "justify-end" : ""}`}>
        <i className="block h-full rounded-full" style={{ width: `${Math.round(ratio * 100)}%`, background: isA ? "var(--accent)" : "var(--rival)", opacity: win ? 1 : 0.38 }} />
      </span>
    </div>
  );
}
