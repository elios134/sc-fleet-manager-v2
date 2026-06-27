import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  ScrollText,
  RefreshCw,
  Skull,
  Swords,
  Rocket,
  Navigation,
  MapPin,
  Globe,
  LogIn,
  ShoppingCart,
  Plus,
  Loader2,
  type LucideIcon,
} from "lucide-react";

/* ──────────────────────────────────────────────────────────────────────────
 * Carnet de bord v2 (cf. docs/maquette-carnet-v2.html) : bandeau de stats,
 * timeline filtrable groupée par session, panneaux de synthèse. Données issues
 * de get_journal_stats (agrégats) + get_recent_gamelog_events (timeline) +
 * TradeJournal (commerce). DA SC Fleet : accent, glassmorphism, lucide, i18n.
 * ────────────────────────────────────────────────────────────────────────── */

type GameLogEvent = {
  id: number;
  kind: string;
  summary: string;
  detail: Record<string, unknown> | null;
  occurredAt: string | null;
  createdAt: string | null;
};

type Stats = {
  character: string | null;
  sessions: number;
  quantumJumps: number;
  deaths: { total: number; pvp: number; pve: number; suicide: number };
  kills: { total: number; pvp: number; pve: number };
  kd: number | null;
  vehicles: { name: string; count: number }[];
  systems: { name: string; count: number }[];
  trade: { spent: number; earned: number; profit: number; count: number };
};

type Category = "combat" | "voyage" | "commerce" | "systeme" | "social";

const CAT_COLOR: Record<Category, string> = {
  combat: "#f87171",
  voyage: "#60a5fa",
  commerce: "#5dcaa5",
  systeme: "#a78bfa",
  social: "#fbbf24",
};

// Mapping kind d'événement → catégorie + icône.
const KIND_META: Record<string, { cat: Category; Icon: LucideIcon }> = {
  death: { cat: "combat", Icon: Skull },
  vehicle: { cat: "voyage", Icon: Rocket },
  quantum: { cat: "voyage", Icon: Navigation },
  location: { cat: "voyage", Icon: MapPin },
  system: { cat: "systeme", Icon: Globe },
  session: { cat: "systeme", Icon: LogIn },
  activity: { cat: "systeme", Icon: Loader2 },
  commodity_buy: { cat: "commerce", Icon: ShoppingCart },
  commodity_sell: { cat: "commerce", Icon: ShoppingCart },
};

function metaFor(kind: string) {
  return KIND_META[kind] ?? { cat: "systeme" as Category, Icon: ScrollText };
}

// Heuristique PNJ (miroir de is_npc côté Rust) pour taguer PVE/PVP.
function isNpc(name: string): boolean {
  const l = name.toLowerCase();
  return (
    l.includes("npc") ||
    l.includes("pu_") ||
    l.includes("aimodule") ||
    l.includes("kopion") ||
    l.includes("ninetails") ||
    l.includes("quasi") ||
    l.includes("enemy") ||
    /_\d{6,}$/.test(name)
  );
}

function fmtAuec(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}
function fmtCompact(n: number | null | undefined): string {
  if (n == null) return "—";
  const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toFixed(2)} M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(0)} k`;
  return `${Math.round(n)}`;
}
function fmtTime(raw: string | null): string {
  if (!raw) return "";
  const d = new Date(raw.includes("T") ? raw : raw.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
function fmtDay(raw: string | null): string {
  if (!raw) return "—";
  const d = new Date(raw.includes("T") ? raw : raw.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short" });
}

type Session = { start: GameLogEvent | null; events: GameLogEvent[] };

// Regroupe les événements par session (un event kind='session' démarre une session).
function groupBySession(events: GameLogEvent[]): Session[] {
  const asc = [...events].sort((a, b) => a.id - b.id); // chronologique
  const groups: Session[] = [];
  let cur: Session | null = null;
  for (const e of asc) {
    if (e.kind === "session" || cur === null) {
      cur = { start: e.kind === "session" ? e : null, events: [] };
      groups.push(cur);
    }
    cur.events.push(e);
  }
  return groups.reverse(); // session la plus récente en premier
}

export default function JournalPage() {
  const { t } = useTranslation();
  const [days, setDays] = useState<number | null>(30);
  const [filter, setFilter] = useState<Category | "all">("all");
  const [stats, setStats] = useState<Stats | null>(null);
  const [events, setEvents] = useState<GameLogEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [replaying, setReplaying] = useState(false);
  const [replayMsg, setReplayMsg] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    const [s, ev] = await Promise.all([
      invoke<Stats>("get_journal_stats", { days }).catch(() => null),
      invoke<GameLogEvent[]>("get_recent_gamelog_events", { limit: 500, kinds: [] }).catch(
        () => [] as GameLogEvent[],
      ),
    ]);
    setStats(s);
    setEvents(ev);
    setLoading(false);
  }, [days]);

  useEffect(() => {
    void load();
    const p1 = listen("gamelog:event", () => void load());
    const p2 = listen("trade:journal", () => void load());
    return () => {
      void p1.then((un) => un());
      void p2.then((un) => un());
    };
  }, [load]);

  async function replay() {
    setReplaying(true);
    setReplayMsg(null);
    try {
      const n = await invoke<number>("replay_gamelog");
      setReplayMsg(t("journal.replayDone", { count: n }));
      await load();
    } catch (e) {
      setReplayMsg(String(e));
    } finally {
      setReplaying(false);
    }
  }

  const sessions = useMemo(() => groupBySession(events), [events]);

  return (
    <div className="flex h-full flex-col overflow-auto p-6">
      {/* ── En-tête ── */}
      <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-3">
          <div
            className="flex h-11 w-11 items-center justify-center rounded-xl"
            style={{ background: "rgba(127,119,221,.12)", color: "#a78bfa" }}
          >
            <ScrollText className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">{t("journal.title")}</h1>
            <p className="text-xs text-white/50">{t("journal.subtitle")}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-white/10">
            {([null, 30, 7] as const).map((d) => (
              <button
                key={String(d)}
                onClick={() => setDays(d)}
                className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                  days === d ? "bg-[var(--accent)] text-black" : "bg-white/5 text-white/70 hover:bg-white/10"
                }`}
              >
                {d === null ? t("journal.periodAll") : t("journal.periodDays", { n: d })}
              </button>
            ))}
          </div>
          <button
            onClick={() => void replay()}
            disabled={replaying}
            className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-semibold text-black disabled:opacity-50"
            style={{ background: "var(--accent)" }}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${replaying ? "animate-spin" : ""}`} />
            {t("journal.replay")}
          </button>
        </div>
      </header>
      {replayMsg && <div className="mb-3 text-xs text-white/50">{replayMsg}</div>}

      {/* ── Bandeau de stats ── */}
      <StatsBar stats={stats} t={t} />

      {/* ── Corps : timeline + panneaux ── */}
      <div className="mt-4 grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-[1fr_340px]">
        <TimelineCard
          loading={loading}
          sessions={sessions}
          filter={filter}
          setFilter={setFilter}
          character={stats?.character ?? null}
          t={t}
        />
        <div className="flex flex-col gap-4">
          <DeathsCard stats={stats} t={t} />
          <VehiclesCard stats={stats} t={t} />
          <TradeCard stats={stats} t={t} onAdd={() => setShowForm(true)} />
        </div>
      </div>

      {showForm && <TradeForm t={t} onClose={() => setShowForm(false)} onAdded={() => { setShowForm(false); void load(); }} />}
    </div>
  );
}

/* ─────────────────────────────── Bandeau de stats ────────────────────────── */

function StatsBar({ stats, t }: { stats: Stats | null; t: TFunction }) {
  const topSystem = stats?.systems?.[0];
  const totalSys = (stats?.systems ?? []).reduce((a, s) => a + s.count, 0);
  const pct = topSystem && totalSys > 0 ? Math.round((topSystem.count / totalSys) * 100) : null;

  const cards = [
    {
      icon: LogIn,
      tint: "rgba(255,197,106,.12)",
      color: "var(--accent)",
      value: String(stats?.sessions ?? 0),
      label: t("journal.sessions"),
      sub: stats?.character ? `${t("journal.character")} : ${stats.character}` : t("journal.noCharacter"),
    },
    {
      icon: Swords,
      tint: "rgba(248,113,113,.14)",
      color: "#f87171",
      value: stats?.kd != null ? stats.kd.toFixed(2) : "—",
      label: t("journal.kd"),
      sub: `K ${stats?.kills.total ?? 0} · D ${stats?.deaths.total ?? 0}`,
    },
    {
      icon: Skull,
      tint: "rgba(248,113,113,.14)",
      color: "#f87171",
      value: String(stats?.deaths.total ?? 0),
      label: t("journal.deaths"),
      sub: `PVP ${stats?.deaths.pvp ?? 0} · PVE ${stats?.deaths.pve ?? 0} · ${t("journal.suicide")} ${stats?.deaths.suicide ?? 0}`,
    },
    {
      icon: Navigation,
      tint: "rgba(96,165,250,.14)",
      color: "#60a5fa",
      value: String(stats?.quantumJumps ?? 0),
      label: t("journal.quantum"),
      sub: `${stats?.systems.length ?? 0} ${t("journal.systemsSeen")}`,
    },
    {
      icon: ShoppingCart,
      tint: "rgba(93,202,165,.14)",
      color: "#5dcaa5",
      value: (stats?.trade.profit ?? 0) >= 0 ? `+${fmtCompact(stats?.trade.profit)}` : fmtCompact(stats?.trade.profit),
      label: t("journal.tradeProfit"),
      sub: `${stats?.trade.count ?? 0} ${t("journal.transactionsShort")}`,
      valueColor: (stats?.trade.profit ?? 0) >= 0 ? "#5dcaa5" : "#f87171",
    },
    {
      icon: Globe,
      tint: "rgba(167,139,250,.14)",
      color: "#a78bfa",
      value: pct != null ? `${pct}%` : "—",
      label: topSystem ? topSystem.name : t("journal.mainSystem"),
      sub: t("journal.mainSystem"),
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      {cards.map((c, i) => (
        <div key={i} className="overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-3.5">
          <div
            className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg"
            style={{ background: c.tint, color: c.color }}
          >
            <c.icon className="h-4 w-4" />
          </div>
          <div className="text-2xl font-bold leading-none text-white" style={{ color: c.valueColor }}>
            {c.value}
          </div>
          <div className="mt-1 truncate text-[11px] uppercase tracking-wider text-white/40">{c.label}</div>
          <div className="mt-1.5 truncate text-[11px] text-white/55" title={c.sub}>
            {c.sub}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────────────── Timeline ──────────────────────────────── */

const FILTERS: { key: Category | "all"; labelKey: string }[] = [
  { key: "all", labelKey: "journal.filterAll" },
  { key: "combat", labelKey: "journal.catCombat" },
  { key: "voyage", labelKey: "journal.catVoyage" },
  { key: "commerce", labelKey: "journal.catCommerce" },
  { key: "systeme", labelKey: "journal.catSystem" },
  { key: "social", labelKey: "journal.catSocial" },
];

function deathTag(ev: GameLogEvent, character: string | null): { label: string; color: string } | null {
  if (ev.kind !== "death" || !ev.detail) return null;
  const victim = String(ev.detail.victim ?? "");
  const killer = String(ev.detail.killer ?? "");
  if (victim && killer && victim === killer) return { label: "SUICIDE", color: "#a78bfa" };
  const other = character && victim === character ? killer : character && killer === character ? victim : "";
  if (!other) return null;
  return isNpc(other) ? { label: "PVE", color: "#fdba74" } : { label: "PVP", color: "#fca5a5" };
}

function TimelineCard({
  loading,
  sessions,
  filter,
  setFilter,
  character,
  t,
}: {
  loading: boolean;
  sessions: Session[];
  filter: Category | "all";
  setFilter: (c: Category | "all") => void;
  character: string | null;
  t: TFunction;
}) {
  const visibleSessions = sessions
    .map((s) => ({
      ...s,
      events: s.events.filter((e) => filter === "all" || metaFor(e.kind).cat === filter),
    }))
    .filter((s) => s.events.length > 0);

  return (
    <div className="flex min-h-0 flex-col rounded-2xl border border-white/10 bg-white/5">
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-white">{t("journal.tabActivity")}</h2>
        <span className="text-[11px] uppercase tracking-wider text-white/35">{t("journal.bySession")}</span>
      </div>
      <div className="flex flex-wrap gap-2 px-4 py-3">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
              filter === f.key
                ? "border-white/15 bg-white/10 text-white"
                : "border-white/10 bg-white/[0.02] text-white/55 hover:bg-white/5"
            }`}
          >
            {f.key !== "all" && (
              <span className="h-2 w-2 rounded-full" style={{ background: CAT_COLOR[f.key as Category] }} />
            )}
            {t(f.labelKey)}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-2 pb-3">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-white/40">
            <Loader2 className="h-4 w-4 animate-spin" /> {t("journal.loading")}
          </div>
        ) : visibleSessions.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <ScrollText className="h-10 w-10 text-white/20" />
            <p className="max-w-md text-sm text-white/50">{t("journal.empty")}</p>
          </div>
        ) : (
          visibleSessions.map((s, i) => (
            <SessionBlock key={i} session={s} character={character} t={t} />
          ))
        )}
      </div>
    </div>
  );
}

function SessionBlock({ session, character, t }: { session: Session; character: string | null; t: TFunction }) {
  const first = session.events[0];
  const last = session.events[session.events.length - 1];
  const charName = (session.start?.detail?.character as string | undefined) ?? null;
  return (
    <div className="mb-2">
      <div className="mx-1 mb-1 flex items-center justify-between rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2">
        <span className="text-[13px] font-semibold text-white">
          {fmtDay(first.occurredAt ?? first.createdAt)} · {fmtTime(first.occurredAt ?? first.createdAt)} →{" "}
          {fmtTime(last.occurredAt ?? last.createdAt)}
        </span>
        <span className="truncate text-[11px] text-white/35">
          {charName ?? character ?? ""} · {t("journal.eventsN", { n: session.events.length })}
        </span>
      </div>
      <div className="px-1">
        {session.events.map((e, idx) => {
          const m = metaFor(e.kind);
          const color = CAT_COLOR[m.cat];
          const tag = deathTag(e, character);
          const isLast = idx === session.events.length - 1;
          const profit =
            e.kind === "commodity_sell" && e.detail?.totalPrice != null
              ? Number(e.detail.totalPrice)
              : null;
          return (
            <div key={e.id} className="flex gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-white/[0.035]">
              <div className="flex w-[30px] flex-none flex-col items-center">
                <div
                  className="flex h-[30px] w-[30px] items-center justify-center rounded-lg"
                  style={{ background: `${color}22`, color }}
                >
                  <m.Icon className="h-[15px] w-[15px]" />
                </div>
                {!isLast && <div className="mt-1 w-px flex-1 bg-white/10" />}
              </div>
              <div className="min-w-0 flex-1 pt-0.5">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-white">{e.summary}</span>
                  <span className="flex-none text-[11px] text-white/35">
                    {fmtTime(e.occurredAt ?? e.createdAt)}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-white/50">
                  {tag && (
                    <span
                      className="rounded px-1.5 py-px text-[10px] font-bold"
                      style={{ background: `${tag.color}26`, color: tag.color }}
                    >
                      {tag.label}
                    </span>
                  )}
                  {profit != null && (
                    <span className="font-semibold text-[#5dcaa5]">+{fmtAuec(profit)} aUEC</span>
                  )}
                  {e.detail?.zone != null && <span className="truncate">{String(e.detail.zone)}</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────────────────────────── Panneaux ──────────────────────────────── */

function Panel({ title, extra, children }: { title: string; extra?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5">
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-white">{title}</h3>
        {extra && <span className="text-[11px] uppercase tracking-wider text-white/35">{extra}</span>}
      </div>
      {children}
    </div>
  );
}

function Bar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div>
      <div className="mb-1 flex justify-between text-[13px]">
        <span className="text-white/85">{label}</span>
        <span className="text-white/50">{value}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

function DeathsCard({ stats, t }: { stats: Stats | null; t: TFunction }) {
  const d = stats?.deaths;
  const max = Math.max(1, d?.pvp ?? 0, d?.pve ?? 0, d?.suicide ?? 0);
  return (
    <Panel title={t("journal.deathsBreakdown")}>
      <div className="flex flex-col gap-3 px-4 py-4">
        <Bar label="PVP" value={d?.pvp ?? 0} max={max} color="#f87171" />
        <Bar label="PVE" value={d?.pve ?? 0} max={max} color="#fdba74" />
        <Bar label={t("journal.suicideAsphyxia")} value={d?.suicide ?? 0} max={max} color="#a78bfa" />
      </div>
    </Panel>
  );
}

function VehiclesCard({ stats, t }: { stats: Stats | null; t: TFunction }) {
  const list = stats?.vehicles ?? [];
  const total = list.reduce((a, v) => a + v.count, 0);
  return (
    <Panel title={t("journal.topVehicles")}>
      {list.length === 0 ? (
        <div className="px-4 py-6 text-center text-xs text-white/35">{t("journal.noVehicles")}</div>
      ) : (
        list.map((v, i) => (
          <div
            key={v.name}
            className="flex items-center justify-between border-t border-white/5 px-4 py-2.5 text-[13px] first:border-0"
          >
            <span className="flex min-w-0 items-center gap-2.5 text-white">
              <span
                className="h-2.5 w-2.5 flex-none rounded-sm"
                style={{ background: `hsl(210 90% ${70 - i * 8}%)` }}
              />
              <span className="truncate">{v.name}</span>
            </span>
            <span className="flex-none text-white/55">
              {total > 0 ? `${Math.round((v.count / total) * 100)} %` : v.count}
            </span>
          </div>
        ))
      )}
    </Panel>
  );
}

function TradeCard({ stats, t, onAdd }: { stats: Stats | null; t: TFunction; onAdd: () => void }) {
  const tr = stats?.trade;
  return (
    <Panel title={t("journal.tradePnl")} extra={t("journal.tradeCount", { n: tr?.count ?? 0 })}>
      <div className="grid grid-cols-3 gap-2.5 px-4 py-4">
        <div className="rounded-xl border border-white/5 bg-white/[0.02] p-2.5 text-center">
          <div className="text-lg font-bold text-[#f87171]">{fmtCompact(tr?.spent)}</div>
          <div className="mt-0.5 text-[10px] uppercase tracking-wide text-white/40">{t("journal.spent")}</div>
        </div>
        <div className="rounded-xl border border-white/5 bg-white/[0.02] p-2.5 text-center">
          <div className="text-lg font-bold text-[#5dcaa5]">{fmtCompact(tr?.earned)}</div>
          <div className="mt-0.5 text-[10px] uppercase tracking-wide text-white/40">{t("journal.earned")}</div>
        </div>
        <div className="rounded-xl border border-white/5 bg-white/[0.02] p-2.5 text-center">
          <div className="text-lg font-bold" style={{ color: (tr?.profit ?? 0) >= 0 ? "#5dcaa5" : "#f87171" }}>
            {(tr?.profit ?? 0) >= 0 ? "+" : ""}
            {fmtCompact(tr?.profit)}
          </div>
          <div className="mt-0.5 text-[10px] uppercase tracking-wide text-white/40">{t("journal.profit")}</div>
        </div>
      </div>
      <div className="px-4 pb-4">
        <button
          onClick={onAdd}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 py-2 text-xs font-semibold text-white/80 hover:bg-white/10"
        >
          <Plus className="h-3.5 w-3.5" /> {t("journal.addEntry")}
        </button>
      </div>
    </Panel>
  );
}

/* ─────────────────────── Saisie manuelle d'une transaction ───────────────── */

function TradeForm({ t, onClose, onAdded }: { t: TFunction; onClose: () => void; onAdded: () => void }) {
  const [action, setAction] = useState<"buy" | "sell">("sell");
  const [commodity, setCommodity] = useState("");
  const [scu, setScu] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [location, setLocation] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!commodity.trim()) return;
    setBusy(true);
    try {
      await invoke("add_trade_journal_entry", {
        action,
        commodity: commodity.trim(),
        scu: scu ? Number(scu) : null,
        unitPrice: unitPrice ? Number(unitPrice) : null,
        totalPrice: null,
        location: location.trim() || null,
      });
      onAdded();
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  }

  const input =
    "rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-[var(--accent)]/50 focus:outline-none";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-white/15 bg-[#14101f]/90 p-5 backdrop-blur-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-white">
          {t("journal.addEntry")}
        </h3>
        <div className="grid grid-cols-2 gap-2">
          <select value={action} onChange={(e) => setAction(e.target.value as "buy" | "sell")} className={input}>
            <option value="buy">{t("journal.buy")}</option>
            <option value="sell">{t("journal.sell")}</option>
          </select>
          <input className={input} placeholder={t("journal.fCommodity")} value={commodity} onChange={(e) => setCommodity(e.target.value)} />
          <input className={input} placeholder={t("journal.fScu")} inputMode="decimal" value={scu} onChange={(e) => setScu(e.target.value)} />
          <input className={input} placeholder={t("journal.fUnitPrice")} inputMode="decimal" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} />
          <input className={`${input} col-span-2`} placeholder={t("journal.fLocation")} value={location} onChange={(e) => setLocation(e.target.value)} />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-white/10 px-3 py-2 text-sm text-white/70 hover:bg-white/5">
            {t("common.cancel")}
          </button>
          <button
            onClick={() => void submit()}
            disabled={busy || !commodity.trim()}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
            style={{ background: "var(--accent)" }}
          >
            {t("journal.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
