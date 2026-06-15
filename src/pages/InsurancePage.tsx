import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { Loader2, ShieldCheck, Clock, X } from "lucide-react";
import { useTranslation } from "react-i18next";

/* ── Types ── */

type InsuranceShip = {
  id: number;
  name: string;
  manufacturer: string;
  lti: number;
  insuranceDuration: number | null;
  insuranceExpiry: string | null;
};

type UiStatus = "ACTIVE" | "WARNING" | "EXPIRED";
type Tab = "all" | "active" | "attention" | "expired";

type Row = {
  shipId: number;
  name: string;
  manufacturer: string;
  lti: boolean;
  insuranceDuration: number | null;
  typeLabel: string;
  expiryLabel: string;
  status: UiStatus;
  daysLeft: number | null;
  expiryIso: string | null;
};

/* ── Logique assurance (réplique utils/insuranceAlert.ts V1) ── */

type Status = "ok" | "warning" | "critical" | "expired";

function getInsuranceStatus(expiry: Date | null): Status {
  if (!expiry) return "ok";
  const days = Math.floor((expiry.getTime() - Date.now()) / 86_400_000);
  if (days < 0) return "expired";
  if (days < 7) return "critical";
  if (days < 30) return "warning";
  return "ok";
}

function getInsuranceDaysLeft(expiry: Date | null): number | null {
  if (!expiry) return null;
  return Math.floor((expiry.getTime() - Date.now()) / 86_400_000);
}

function formatInsuranceType(lti: boolean, months: number | null): string {
  if (lti) return "LTI";
  if (months != null) return `SHI (${months}M)`;
  return "SHI";
}

function addMonths(base: Date, n: number): Date {
  const d = new Date(base);
  d.setMonth(d.getMonth() + n);
  return d;
}

function uiStatusFrom(status: Status, daysLeft: number | null): UiStatus {
  if (status === "expired") return "EXPIRED";
  if (status === "ok") return "ACTIVE";
  if (daysLeft !== null && daysLeft < 30) return "WARNING";
  return "ACTIVE";
}

function expiryLabel(s: InsuranceShip): string {
  if (s.lti === 1) return "";
  if (!s.insuranceExpiry) return "—";
  const t = new Date(s.insuranceExpiry).getTime();
  if (!Number.isFinite(t)) return "—";
  return new Date(t).toISOString().slice(0, 10);
}

function buildRow(s: InsuranceShip): Row {
  const lti = s.lti === 1;
  const expiryIso = s.insuranceExpiry ?? null;
  const expiryDate = expiryIso ? new Date(expiryIso) : null;
  const status = getInsuranceStatus(expiryDate);
  const daysLeft = getInsuranceDaysLeft(expiryDate);
  return {
    shipId: s.id,
    name: s.name,
    manufacturer: s.manufacturer,
    lti,
    insuranceDuration: s.insuranceDuration ?? null,
    typeLabel: formatInsuranceType(lti, s.insuranceDuration ?? null),
    expiryLabel: expiryLabel(s),
    status: uiStatusFrom(status, daysLeft),
    daysLeft,
    expiryIso,
  };
}

const STATUS_CFG: Record<UiStatus, { labelKey: string; color: string }> = {
  ACTIVE: { labelKey: "insurance.statusActiveLabel", color: "#34d399" },
  WARNING: { labelKey: "insurance.statusWarningLabel", color: "#fbbf24" },
  EXPIRED: { labelKey: "insurance.statusExpiredLabel", color: "#f87171" },
};

/* ── Page ── */

export default function InsurancePage() {
  const { t } = useTranslation();
  const location = useLocation();
  const [ships, setShips] = useState<InsuranceShip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noAccount, setNoAccount] = useState(false);

  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState("");

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

  const baseRows = useMemo(() => ships.map(buildRow), [ships]);

  const ltiCount = baseRows.filter((r) => r.lti).length;
  const expiringSoon = baseRows.filter(
    (r) => !r.lti && r.daysLeft !== null && r.daysLeft >= 0 && r.daysLeft < 30,
  ).length;
  const activeCount = baseRows.filter((r) => r.status === "ACTIVE").length;
  const attentionCount = baseRows.filter((r) => r.status === "WARNING").length;
  const expiredCount = baseRows.filter((r) => r.status === "EXPIRED").length;

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = baseRows;
    if (tab === "active") list = list.filter((r) => r.status === "ACTIVE");
    if (tab === "attention") list = list.filter((r) => r.status === "WARNING");
    if (tab === "expired") list = list.filter((r) => r.status === "EXPIRED");
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
          {/* KPI */}
          <div className="mb-6 grid max-w-xl grid-cols-2 gap-4">
            <KpiCard
              tone="#34d399"
              value={String(ltiCount).padStart(2, "0")}
              label={t("insurance.kpiLtiShips")}
              icon={<ShieldCheck className="h-5 w-5" />}
            />
            <KpiCard
              tone="#f87171"
              value={String(expiringSoon).padStart(2, "0")}
              label={t("insurance.kpiExpiringSoon")}
              icon={<Clock className="h-5 w-5" />}
            />
          </div>

          {/* Filtres */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex gap-1 rounded-full border border-white/10 bg-white/5 p-1">
              {tabs.map((tb) => (
                <button
                  key={tb.key}
                  onClick={() => setTab(tb.key)}
                  className={[
                    "flex items-center gap-1.5 rounded-full px-3 py-1 text-sm transition-colors",
                    tab === tb.key ? "bg-white/10 text-white" : "text-white/50 hover:text-white/90",
                  ].join(" ")}
                >
                  {tb.label}
                  <span className="rounded-full bg-white/10 px-1.5 text-[10px] font-semibold text-white/60">
                    {tb.count}
                  </span>
                </button>
              ))}
            </div>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("insurance.searchShipPlaceholder")}
              className="w-60 max-w-full rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white placeholder:text-white/40 focus:border-white/20 focus:outline-none"
            />
          </div>

          {/* Table */}
          {rows.length === 0 ? (
            <p className="text-sm text-white/40">
              {baseRows.length === 0
                ? t("insurance.emptyNoShips")
                : t("insurance.emptyNoMatch")}
            </p>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/5">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-xs uppercase tracking-wider text-white/40">
                    <th className="px-4 py-3 font-medium">{t("insurance.colShip")}</th>
                    <th className="px-4 py-3 font-medium">{t("insurance.colTypeShort")}</th>
                    <th className="px-4 py-3 font-medium">{t("insurance.colExpiration")}</th>
                    <th className="px-4 py-3 font-medium">{t("insurance.colStatusShort")}</th>
                    <th className="px-4 py-3 text-right font-medium">{t("insurance.colAction")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const cfg = STATUS_CFG[r.status];
                    return (
                      <tr key={r.shipId} className="border-b border-white/5 last:border-0">
                        <td className="px-4 py-3">
                          <div className="font-medium text-white">{r.name}</div>
                          <div className="text-xs text-white/40">{r.manufacturer}</div>
                        </td>
                        <td className="px-4 py-3 font-mono text-white/70">{r.typeLabel}</td>
                        <td className="px-4 py-3 text-white/70">
                          {r.lti ? t("insurance.renew.perpetual") : r.expiryLabel}
                          {!r.lti && r.daysLeft !== null && (
                            <span className="ml-2 text-xs text-white/40">
                              {r.daysLeft >= 0
                                ? t("insurance.daysUntil", { days: r.daysLeft })
                                : t("insurance.daysOverdue", { days: -r.daysLeft })}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-2" style={{ color: cfg.color }}>
                            <span
                              className="h-2 w-2 rounded-full"
                              style={{ background: cfg.color }}
                            />
                            <span className="text-xs font-semibold uppercase tracking-wider">
                              {t(cfg.labelKey)}
                            </span>
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => handleRenew(r)}
                            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white/80 transition-colors hover:bg-white/10"
                          >
                            {r.lti ? t("insurance.btnLtiInfo") : t("insurance.btnRenew")}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
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

function KpiCard({
  tone,
  value,
  label,
  icon,
}: {
  tone: string;
  value: string;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/5 p-4">
      <div
        className="grid h-12 w-12 shrink-0 place-items-center rounded-xl"
        style={{ background: `color-mix(in oklab, ${tone} 14%, transparent)`, color: tone }}
      >
        {icon}
      </div>
      <div>
        <div className="text-2xl font-bold" style={{ color: tone }}>
          {value}
        </div>
        <div className="mt-0.5 text-xs uppercase tracking-wider text-white/40">{label}</div>
      </div>
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
