import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  ScrollText,
  Skull,
  Rocket,
  MapPin,
  Truck,
  Plus,
  Trash2,
  RefreshCw,
} from "lucide-react";

/* ──────────────────────────────────────────────────────────────────────────
 * Carnet de bord (Phase 1.4) : surface les événements reconstitués depuis le
 * Game.log (GameLogEvent) + le journal de commerce (TradeJournal). Deux onglets :
 *  - Activité : morts, sauts quantiques, véhicules, déplacements.
 *  - Commerce : transactions cargo + P&L + saisie manuelle.
 * Tout se rafraîchit en direct via les events Tauri gamelog:event / trade:journal.
 * ────────────────────────────────────────────────────────────────────────── */

type GameLogEvent = {
  id: number;
  kind: string;
  summary: string;
  detail: Record<string, unknown> | null;
  occurredAt: string | null;
  createdAt: string | null;
};

type TradeEntry = {
  id: number;
  action: "buy" | "sell";
  commodity: string;
  scu: number | null;
  unitPrice: number | null;
  totalPrice: number | null;
  location: string | null;
  source: string;
  occurredAt: string | null;
  createdAt: string | null;
};

type TradeStats = { spent: number; earned: number; profit: number; count: number };

const KIND_ICON: Record<string, typeof Skull> = {
  death: Skull,
  vehicle: Rocket,
  quantum: Rocket,
  location: MapPin,
  commodity_buy: Truck,
  commodity_sell: Truck,
};

function formatDate(raw: string | null): string {
  if (!raw) return "—";
  const d = new Date(raw.includes("T") ? raw : raw.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtAuec(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export default function JournalPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"activity" | "trade">("activity");

  return (
    <div className="flex h-full flex-col p-4">
      <header className="mb-4 flex items-center gap-3">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-xl"
          style={{ background: "rgba(127,119,221,.12)", color: "#7f77dd" }}
        >
          <ScrollText className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white">{t("journal.title")}</h1>
          <p className="text-xs text-white/50">{t("journal.subtitle")}</p>
        </div>
      </header>

      <div className="mb-4 flex gap-2">
        {(["activity", "trade"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              tab === k
                ? "bg-[var(--accent)] text-black"
                : "border border-white/10 bg-white/5 text-white/70 hover:bg-white/10"
            }`}
          >
            {t(k === "activity" ? "journal.tabActivity" : "journal.tabTrade")}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {tab === "activity" ? <ActivityTab t={t} /> : <TradeTab t={t} />}
      </div>
    </div>
  );
}

/* ─────────────────────────────── Onglet Activité ─────────────────────────── */

function ActivityTab({ t }: { t: TFunction }) {
  const [events, setEvents] = useState<GameLogEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const list = await invoke<GameLogEvent[]>("get_recent_gamelog_events", {
      limit: 200,
      kinds: [],
    }).catch(() => [] as GameLogEvent[]);
    setEvents(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const pending = listen("gamelog:event", () => void load());
    return () => {
      void pending.then((un) => un());
    };
  }, [load]);

  if (loading) {
    return <div className="py-10 text-center text-sm text-white/40">{t("journal.loading")}</div>;
  }
  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <ScrollText className="h-10 w-10 text-white/20" />
        <p className="max-w-md text-sm text-white/50">{t("journal.empty")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {events.map((e) => {
        const Icon = KIND_ICON[e.kind] ?? ScrollText;
        return (
          <div
            key={e.id}
            className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5"
          >
            <Icon className="h-4 w-4 shrink-0 text-white/40" />
            <span className="min-w-0 flex-1 truncate text-[13px] text-white/85">{e.summary}</span>
            <span className="shrink-0 text-[11px] text-white/35">
              {formatDate(e.occurredAt ?? e.createdAt)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ─────────────────────────────── Onglet Commerce ─────────────────────────── */

function TradeTab({ t }: { t: TFunction }) {
  const [entries, setEntries] = useState<TradeEntry[]>([]);
  const [stats, setStats] = useState<TradeStats | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    const [list, st] = await Promise.all([
      invoke<TradeEntry[]>("list_trade_journal", { limit: 200 }).catch(() => [] as TradeEntry[]),
      invoke<TradeStats>("get_trade_journal_stats").catch(() => null),
    ]);
    setEntries(list);
    setStats(st);
  }, []);

  useEffect(() => {
    void load();
    const pending = listen("trade:journal", () => void load());
    return () => {
      void pending.then((un) => un());
    };
  }, [load]);

  async function remove(id: number) {
    await invoke("delete_trade_journal_entry", { id }).catch(() => {});
    void load();
  }

  return (
    <div className="space-y-4">
      {/* Stats P&L */}
      <div className="grid grid-cols-3 gap-3">
        <StatBox label={t("journal.spent")} value={fmtAuec(stats?.spent)} color="#f87171" />
        <StatBox label={t("journal.earned")} value={fmtAuec(stats?.earned)} color="#34d399" />
        <StatBox
          label={t("journal.profit")}
          value={fmtAuec(stats?.profit)}
          color={(stats?.profit ?? 0) >= 0 ? "#5dcaa5" : "#f87171"}
        />
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-white/40">
          {t("journal.transactions", { count: stats?.count ?? 0 })}
        </span>
        <div className="flex gap-2">
          <button
            onClick={() => void load()}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/70 hover:bg-white/10"
          >
            <RefreshCw className="h-3.5 w-3.5" /> {t("journal.refresh")}
          </button>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-black"
            style={{ background: "var(--accent)" }}
          >
            <Plus className="h-3.5 w-3.5" /> {t("journal.addEntry")}
          </button>
        </div>
      </div>

      {showForm && <TradeForm t={t} onAdded={() => { setShowForm(false); void load(); }} />}

      {entries.length === 0 ? (
        <div className="py-10 text-center text-sm text-white/40">{t("journal.noTrade")}</div>
      ) : (
        <div className="space-y-1.5">
          {entries.map((e) => (
            <div
              key={e.id}
              className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5"
            >
              <span
                className="shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase"
                style={{
                  background: e.action === "buy" ? "rgba(248,113,113,.15)" : "rgba(52,211,153,.15)",
                  color: e.action === "buy" ? "#f87171" : "#34d399",
                }}
              >
                {t(e.action === "buy" ? "journal.buy" : "journal.sell")}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] text-white/85">
                  {e.commodity}
                  {e.scu != null && <span className="text-white/40"> · {e.scu} SCU</span>}
                </div>
                <div className="truncate text-[11px] text-white/35">
                  {e.location ?? "—"} · {formatDate(e.occurredAt ?? e.createdAt)}
                  {e.source === "gamelog" && ` · ${t("journal.auto")}`}
                </div>
              </div>
              <span className="shrink-0 text-[13px] font-semibold text-white/80">
                {fmtAuec(e.totalPrice)} aUEC
              </span>
              <button
                onClick={() => void remove(e.id)}
                className="shrink-0 text-white/30 hover:text-red-400"
                aria-label={t("journal.delete")}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatBox({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
      <div className="text-[11px] uppercase tracking-wider text-white/40">{label}</div>
      <div className="mt-1 text-lg font-bold" style={{ color }}>
        {value}
      </div>
    </div>
  );
}

function TradeForm({ t, onAdded }: { t: TFunction; onAdded: () => void }) {
  const [action, setAction] = useState<"buy" | "sell">("buy");
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
      setCommodity("");
      setScu("");
      setUnitPrice("");
      setLocation("");
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
    <div className="grid grid-cols-2 gap-2 rounded-xl border border-white/10 bg-black/20 p-3 md:grid-cols-3">
      <select
        value={action}
        onChange={(e) => setAction(e.target.value as "buy" | "sell")}
        className={input}
      >
        <option value="buy">{t("journal.buy")}</option>
        <option value="sell">{t("journal.sell")}</option>
      </select>
      <input
        className={input}
        placeholder={t("journal.fCommodity")}
        value={commodity}
        onChange={(e) => setCommodity(e.target.value)}
      />
      <input
        className={input}
        placeholder={t("journal.fScu")}
        inputMode="decimal"
        value={scu}
        onChange={(e) => setScu(e.target.value)}
      />
      <input
        className={input}
        placeholder={t("journal.fUnitPrice")}
        inputMode="decimal"
        value={unitPrice}
        onChange={(e) => setUnitPrice(e.target.value)}
      />
      <input
        className={input}
        placeholder={t("journal.fLocation")}
        value={location}
        onChange={(e) => setLocation(e.target.value)}
      />
      <button
        onClick={() => void submit()}
        disabled={busy || !commodity.trim()}
        className="rounded-lg px-3 py-2 text-sm font-semibold text-black disabled:opacity-50"
        style={{ background: "var(--accent)" }}
      >
        {t("journal.save")}
      </button>
    </div>
  );
}
