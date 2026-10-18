import { Kpis, ExpiryTimeline, InsuranceCard } from "./components/InsuranceViews";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { Loader2, X } from "lucide-react";
import { usePersistentState } from "../../lib/uiPersist";
import { useTranslation } from "react-i18next";
import {
  addMonths,
  buildInsuranceRow,
  type InsuranceShip,
  type InsuranceRow as Row,
  type UiStatus,
} from "../../lib/insurance";

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

/* ── Modale renouvellement ── */

type TierKey = "standard" | "lti";
const QUICK_MONTHS = [1, 3, 6, 12, 24];

function RenewInsuranceModal({
  row,
  onClose,
  onSaved,
}: {
  row: Row;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [tier, setTier] = useState<TierKey>("standard");
  const [durationInput, setDurationInput] = useState<string>(
    row.insuranceDuration != null ? String(row.insuranceDuration) : "",
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const isLti = tier === "lti";
  const durationMonths = isLti ? null : parseInt(durationInput, 10) || null;
  const canSave = isLti || (durationMonths != null && durationMonths >= 1);

  const newExpiry = useMemo(() => {
    if (isLti || !durationMonths || durationMonths < 1) return null;
    return addMonths(new Date(), durationMonths);
  }, [isLti, durationMonths]);

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setSaveError(null);
    try {
      await invoke("renew_insurance", {
        shipId: row.shipId,
        newExpiryIso: newExpiry ? newExpiry.toISOString() : null,
        insuranceDuration: isLti ? null : durationMonths,
      });
      onSaved();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative z-10 max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border p-6 backdrop-blur-2xl"
        style={{ background: "rgba(20,20,28,0.92)", borderColor: "var(--card-border)" }}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wider text-white/40">{t("insurance.renewKicker")}</p>
            <h2 className="text-lg font-bold text-white">{row.name}</h2>
            <p className="text-sm text-white/50">{row.manufacturer}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-white/60 hover:bg-white/10"
            aria-label={t("action.close")}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Niveau de couverture */}
        <p className="mb-2 text-xs uppercase tracking-wider text-white/40">{t("insurance.coverageType")}</p>
        <div className="mb-4 grid grid-cols-2 gap-2">
          <button
            onClick={() => setTier("standard")}
            className={[
              "rounded-xl border p-3 text-left text-sm transition-colors",
              tier === "standard"
                ? "border-indigo-500/40 bg-indigo-500/15 text-white"
                : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10",
            ].join(" ")}
          >
            <p className="font-semibold">{t("insurance.tierStandard")}</p>
            <p className="mt-0.5 text-xs text-white/40">{t("insurance.tierStandardDesc")}</p>
          </button>
          <button
            onClick={() => setTier("lti")}
            className={[
              "rounded-xl border p-3 text-left text-sm transition-colors",
              tier === "lti"
                ? "border-emerald-500/40 bg-emerald-500/15 text-white"
                : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10",
            ].join(" ")}
          >
            <p className="font-semibold">{t("insurance.tierLti")}</p>
            <p className="mt-0.5 text-xs text-white/40">{t("insurance.tierLtiDesc")}</p>
          </button>
        </div>

        {/* Durée */}
        <div className={isLti ? "pointer-events-none opacity-40" : ""}>
          <p className="mb-2 text-xs uppercase tracking-wider text-white/40">{t("insurance.duration")}</p>
          <div className="mb-2 flex items-center gap-2">
            <input
              type="number"
              min={1}
              value={durationInput}
              disabled={isLti}
              onChange={(e) => setDurationInput(e.target.value)}
              placeholder="—"
              className="w-24 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-white/20 focus:outline-none"
            />
            <span className="text-sm text-white/50">{t("insurance.months")}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_MONTHS.map((m) => (
              <button
                key={m}
                disabled={isLti}
                onClick={() => setDurationInput(String(m))}
                className={[
                  "rounded-full border px-3 py-1 text-xs transition-colors",
                  !isLti && durationInput === String(m)
                    ? "border-indigo-500/40 bg-indigo-500/20 text-white"
                    : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10",
                ].join(" ")}
              >
                {t("insurance.renew.monthsChip", { n: m })}
              </button>
            ))}
          </div>
        </div>

        {/* Aperçu nouvelle expiration */}
        <div className="mt-4 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm">
          <p className="text-xs uppercase tracking-wider text-white/40">{t("insurance.newExpiry")}</p>
          <p className="mt-1 text-white/80">
            {isLti
              ? t("insurance.perpetualLifetime")
              : newExpiry
                ? newExpiry.toLocaleDateString("fr-FR", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })
                : "—"}
          </p>
        </div>

        {saveError && (
          <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {saveError}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70 hover:bg-white/10"
          >
            {t("action.cancel")}
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={!canSave || saving}
            className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "…" : t("insurance.renew.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Modale info LTI ── */

function LtiInfoModal({
  shipName,
  manufacturer,
  onClose,
}: {
  shipName: string;
  manufacturer: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative z-10 w-full max-w-sm rounded-2xl border p-6 backdrop-blur-2xl"
        style={{ background: "rgba(20,20,28,0.92)", borderColor: "var(--card-border)" }}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wider text-white/40">{t("insurance.ltiModalKicker")}</p>
            <h2 className="text-lg font-bold text-white">{shipName}</h2>
            <p className="text-sm text-white/50">{manufacturer}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-white/60 hover:bg-white/10"
            aria-label={t("action.close")}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mb-3 flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
          <span className="text-2xl text-emerald-400">∞</span>
          <div>
            <p className="text-sm font-semibold text-emerald-300">{t("insurance.perpetualCoverage")}</p>
            <p className="text-xs text-white/50">{t("insurance.noRenewalNeeded")}</p>
          </div>
        </div>
        <p className="text-sm text-white/60">
          {t("insurance.ltiModalDesc")}
        </p>

        <div className="mt-5 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70 hover:bg-white/10"
          >
            {t("action.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
