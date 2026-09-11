import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { type TFunction } from "i18next";
import { type LucideIcon } from "lucide-react";
import { STALE_AFTER_MS } from "../syncTypes";
import type { GroupState } from "../syncTypes";

type Freshness = { status: "ok" | "stale" | "never"; ageMs: number | null };
function freshnessOf(iso: string | null): Freshness {
  if (!iso) return { status: "never", ageMs: null };
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return { status: "never", ageMs: null };
  const ageMs = Date.now() - t;
  return { status: ageMs >= STALE_AFTER_MS ? "stale" : "ok", ageMs };
}

// « il y a X » localisé, granularité auto (min/heures/jours). null → tiret.
function relativeAge(ageMs: number | null, t: TFunction): string {
  if (ageMs == null) return "—";
  const min = Math.floor(ageMs / 60000);
  if (min < 1) return t("settings.donnees.freshness.justNow");
  if (min < 60) return t("settings.donnees.freshness.agoMinutes", { count: min });
  const hours = Math.floor(min / 60);
  if (hours < 24) return t("settings.donnees.freshness.agoHours", { count: hours });
  const days = Math.floor(hours / 24);
  return t("settings.donnees.freshness.agoDays", { count: days });
}

// Groupe « Données SC Wiki » : tables disjointes, même API → ordre interne libre.

function FreshnessPill({ fresh, ageMs }: { fresh: Freshness; ageMs: number | null }) {
  const { t } = useTranslation();
  const cfg =
    fresh.status === "ok"
      ? { label: t("settings.donnees.freshness.ok"), dot: "#2ee9a5", text: "text-emerald-300", border: "border-emerald-500/30", bg: "bg-emerald-500/10" }
      : fresh.status === "stale"
        ? { label: t("settings.donnees.freshness.stale"), dot: "#f59e0b", text: "text-amber-200", border: "border-amber-500/30", bg: "bg-amber-500/10" }
        : { label: t("settings.donnees.freshness.never"), dot: "rgba(255,255,255,0.35)", text: "text-white/50", border: "border-white/15", bg: "bg-white/5" };
  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${cfg.border} ${cfg.bg} ${cfg.text}`}>
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: cfg.dot }} />
        {cfg.label}
      </span>
      <span className="text-[11px] text-white/40">{relativeAge(ageMs, t)}</span>
    </div>
  );
}

// Ligne d'une SOURCE de données (tableau de fraîcheur) : icône + nom/description +
// pastille de fraîcheur + bouton Synchroniser. Affiche l'état du groupe (étape i/n, partiel)
// en dessous quand il tourne ou vient d'échouer partiellement.
function SourceRow({
  icon: Icon,
  iconBg,
  iconColor,
  name,
  desc,
  state,
  iso,
  onSync,
  disabled,
  running,
  accentBtn,
}: {
  icon: LucideIcon;
  iconBg: string;
  iconColor: string;
  name: ReactNode;
  desc: string;
  state: GroupState;
  iso: string | null;
  onSync: () => void;
  disabled: boolean;
  running: boolean;
  accentBtn?: boolean;
}) {
  const { t } = useTranslation();
  const fresh = freshnessOf(iso);
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
          style={{ background: iconBg, color: iconColor }}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-white">{name}</div>
          <div className="mt-0.5 text-[12px] leading-relaxed text-white/45">{desc}</div>
        </div>
        <FreshnessPill fresh={fresh} ageMs={fresh.ageMs} />
        <button
          onClick={onSync}
          disabled={disabled}
          className={[
            "inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
            accentBtn
              ? "border-amber-500/40 bg-amber-500/15 text-amber-100 hover:bg-amber-500/25"
              : "border-white/15 bg-white/5 text-white/80 hover:bg-white/10",
          ].join(" ")}
        >
          {running && (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          )}
          {t("settings.donnees.sourceSyncBtn")}
        </button>
      </div>

      {/* Progression / résultat du groupe, sous la ligne. */}
      {state.running && (
        <p className="mt-3 text-[12px] text-white/50">
          {t("settings.donnees.groupRunning", {
            step: state.stepLabelKey ? t(state.stepLabelKey) : "",
            index: state.index,
            total: state.total,
          })}
        </p>
      )}
      {!state.running && state.donePartial && (
        <p className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[12px] text-amber-200">
          {t("settings.donnees.groupPartial", {
            count: state.failedKeys.length,
            list: state.failedKeys.map((k) => t(k)).join(", "),
          })}
        </p>
      )}
    </div>
  );
}

// ── Store de sync persistant (hors composant) ──────────────────────────────
// PROBLÈME : la navigation démonte DonneesTab → l'état de sync (chargement/progression)
// et son rendu sont perdus alors que la sync continue côté Rust. Comme les listeners de
// progression sont créés DANS les handlers (portée fonction, pas useEffect), ils survivent
// au démontage ; il suffit que l'état vive AU NIVEAU MODULE et que le composant s'y abonne
// (useSyncExternalStore) → la sync reste visible et se met à jour live en revenant.

export { SourceRow, FreshnessPill, freshnessOf };
