import { Kpis, ExpiryTimeline, InsuranceCard } from "./components/InsuranceViews";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { Loader2 } from "lucide-react";
import { usePersistentState } from "../../lib/uiPersist";
import { useTranslation } from "react-i18next";
import {
  buildInsuranceRow,
  type InsuranceShip,
  type InsuranceRow as Row,
  type UiStatus,
} from "../../lib/insurance";

import { RenewInsuranceModal } from "./components/RenewInsuranceModal";
import { LtiInfoModal } from "./components/LtiInfoModal";
/* ── Types ── */

type Tab = "all" | "active" | "attention" | "lti" | "expired";

/* ── Page ── */

export default function InsurancePage() {
  const { t } = useTranslation();
  const location = useLocation();
  const [ships, setShips] = useState<InsuranceShip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noAccount, setNoAccount] = useState(false);

  const [tab, setTab] = usePersistentState<Tab>("insurance.tab", "all");
  const [query, setQuery] = usePersistentState("insurance.query", "");

  const [renewTarget, setRenewTarget] = useState<Row | null>(null);
  const [ltiTarget, setLtiTarget] = useState<Row | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const accountId = await invoke<string | null>("get_active_account_id");
      if (!accountId) {
        setNoAccount(true);
        return;
      }
      const data = await invoke<InsuranceShip[]>("get_insurance_ships", { accountId });
      setNoAccount(false);
      setShips(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, location.key]);

  const baseRows = useMemo(() => ships.map(buildInsuranceRow), [ships]);

  const ltiCount = baseRows.filter((r) => r.lti).length;
  const activeCount = baseRows.filter((r) => r.status === "ACTIVE").length;
  const attentionCount = baseRows.filter((r) => r.status === "WARNING").length;
  const expiredCount = baseRows.filter((r) => r.status === "EXPIRED").length;

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = baseRows;
    if (tab === "active") list = list.filter((r) => r.status === "ACTIVE");
    if (tab === "attention") list = list.filter((r) => r.status === "WARNING");
    if (tab === "expired") list = list.filter((r) => r.status === "EXPIRED");
    if (tab === "lti") list = list.filter((r) => r.lti);
    if (q) list = list.filter((r) => r.name.toLowerCase().includes(q));
    const rank = (s: UiStatus) => (s === "EXPIRED" ? 0 : s === "WARNING" ? 1 : 2);
    return [...list].sort((a, b) => {
      const r = rank(a.status) - rank(b.status);
      if (r !== 0) return r;
      const ta = a.expiryIso ? new Date(a.expiryIso).getTime() : Number.POSITIVE_INFINITY;
      const tb = b.expiryIso ? new Date(b.expiryIso).getTime() : Number.POSITIVE_INFINITY;
      return ta - tb;
    });
  }, [baseRows, tab, query]);

  function handleRenew(row: Row) {
    if (row.lti) setLtiTarget(row);
    else setRenewTarget(row);
  }

  if (!loading && noAccount) {
    return (
      <div className="p-8">
        <p className="text-white/50">
          {t("insurance.noActiveAccount")}{" "}
          <Link to="/" className="text-[var(--accent)] hover:underline">
            {t("insurance.selectCommander")}
          </Link>
        </p>
      </div>
    );
  }

  const tabs: Array<{ key: Tab; label: string; count: number }> = [
    { key: "all", label: t("insurance.tabAllShips"), count: baseRows.length },
    { key: "active", label: t("insurance.tabActives"), count: activeCount },
    { key: "attention", label: t("insurance.tabAttention"), count: attentionCount },
    { key: "lti", label: "LTI", count: ltiCount },
    { key: "expired", label: t("insurance.tabExpired2"), count: expiredCount },
  ];

  return (
    <div className="p-8">
      <header className="mb-6">
        <p className="text-xs uppercase tracking-[0.18em] text-white/40">{t("insurance.headerKicker")}</p>
        <h1 className="text-2xl font-bold text-white">{t("insurance.headerTitle")}</h1>
      </header>

      {loading ? (
        <div className="flex items-center gap-2 text-white/50">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("insurance.loading")}
        </div>
      ) : error ? (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          {t("insurance.errorPrefix")} {error}
        </p>
      ) : (
        <>
          <Kpis rows={baseRows} />
          <ExpiryTimeline rows={baseRows} />

          {/* Filtres */}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {tabs.map((tb) => (
              <button
                key={tb.key}
                onClick={() => setTab(tb.key)}
                className={[
                  "rounded-full border px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors",
                  tab === tb.key ? "border-[var(--accent)]/60 bg-[var(--accent)]/20 text-white" : "glass text-white/60 hover:text-white",
                ].join(" ")}
              >
                {tb.label}
                <span className="ml-1.5 text-white/40">{tb.count}</span>
              </button>
            ))}
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("insurance.searchShipPlaceholder")}
              className="glass ml-auto w-60 max-w-full rounded-[10px] px-3.5 py-2 text-sm text-white placeholder:text-white/40 focus:outline-none"
            />
          </div>

          {rows.length === 0 ? (
            <p className="text-sm text-white/40">
              {baseRows.length === 0 ? t("insurance.emptyNoShips") : t("insurance.emptyNoMatch")}
            </p>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(270px,1fr))] gap-3">
              {rows.map((r) => <InsuranceCard key={r.shipId} row={r} onRenew={() => handleRenew(r)} />)}
            </div>
          )}
        </>
      )}

      {renewTarget && (
        <RenewInsuranceModal
          row={renewTarget}
          onClose={() => setRenewTarget(null)}
          onSaved={() => {
            setRenewTarget(null);
            void load();
          }}
        />
      )}
      {ltiTarget && (
        <LtiInfoModal
          shipName={ltiTarget.name}
          manufacturer={ltiTarget.manufacturer}
          onClose={() => setLtiTarget(null)}
        />
      )}
    </div>
  );
}
