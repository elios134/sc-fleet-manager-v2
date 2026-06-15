import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { ArrowRight, ExternalLink, Loader2, X } from "lucide-react";
import type { CargoRoute } from "../pages/CargoRoutesPage";

/* ── Types (miroir des structs Rust) ── */
type HierarchyNode = {
  name: string | null;
  slug: string | null;
  typeClass: string | null;
  designation: string | null;
  webUrl: string | null;
};
type LocationHierarchy = {
  system: string | null;
  levels: HierarchyNode[];
};

// typeClassification (SC Wiki) → clé i18n. Fallback : type brut.
const TYPE_KEYS: Record<string, string> = {
  Planet: "cargo.locType.planet",
  Moon: "cargo.locType.moon",
  Settlement: "cargo.locType.settlement",
  Manmade: "cargo.locType.manmade",
  Outpost: "cargo.locType.outpost",
  LandingZone: "cargo.locType.landingZone",
  City: "cargo.locType.city",
  Star: "cargo.locType.star",
  Asteroid: "cargo.locType.asteroid",
  Anomaly: "cargo.locType.anomaly",
};
function typeLabel(type: string | null, t: TFunction): string {
  if (!type) return "";
  const key = TYPE_KEYS[type];
  return key ? t(key) : type;
}
function fmt(n: number): string {
  return Math.round(n).toLocaleString("fr-FR");
}
function stripSystem(s: string | null): string {
  if (!s) return "—";
  return s.replace(/\s*System$/i, "");
}
function relativeAge(iso: string | null, t: TFunction): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const mins = Math.max(0, Math.floor((Date.now() - then) / 60000));
  if (mins < 60) return t("cargo.ageMinutes", { n: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 48) return t("cargo.ageHours", { n: hours });
  return t("cargo.ageDays", { n: Math.floor(hours / 24) });
}

export function RouteDetailsModal({ route, onClose }: { route: CargoRoute; onClose: () => void }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState<LocationHierarchy | null>(null);
  const [to, setTo] = useState<LocationHierarchy | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const [f, tt] = await Promise.all([
          route.fromUuid
            ? invoke<LocationHierarchy>("get_location_hierarchy", { uuid: route.fromUuid })
            : Promise.resolve(null),
          route.toUuid
            ? invoke<LocationHierarchy>("get_location_hierarchy", { uuid: route.toUuid })
            : Promise.resolve(null),
        ]);
        if (!alive) return;
        setFrom(f);
        setTo(tt);
      } catch {
        /* hiérarchie best-effort : on n'échoue jamais la modale */
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [route.fromUuid, route.toUuid]);

  // Esc pour fermer.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const dash = "—";
  const fromTitle = route.fromName ?? route.fromLocation;
  const toTitle = route.toName ?? route.toLocation;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative z-10 max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border backdrop-blur-2xl"
        style={{ background: "rgba(20,20,28,0.92)", borderColor: "var(--card-border)" }}
      >
        <button
          onClick={onClose}
          className="absolute right-3 top-3 z-10 rounded-lg p-1 text-white/60 hover:bg-white/10"
          aria-label={t("cargo.detail.close")}
        >
          <X className="h-5 w-5" />
        </button>

        {/* Header */}
        <header className="px-6 pt-6">
          <p className="text-xs uppercase tracking-[0.18em] text-white/40">{t("cargo.detail.title")}</p>
          <h2 className="mt-0.5 text-xl font-bold capitalize text-white">{route.commodity}</h2>
          <div className="mt-1 flex items-center gap-1.5 text-sm text-white/60">
            <span className="capitalize">{fromTitle}</span>
            <ArrowRight className="h-3.5 w-3.5 shrink-0 text-white/30" />
            <span className="capitalize">{toTitle}</span>
          </div>
          <p className="mt-1 text-[11px] text-white/40">
            {t("cargo.results.priceAge")} {relativeAge(route.priceTimestamp, t)}
          </p>
        </header>

        {/* Récap de la route */}
        <section className="px-6 pt-5">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <Cell label={t("cargo.results.buy")} value={`${fmt(route.buyPrice)} aUEC/SCU`} />
            <Cell label={t("cargo.results.sell")} value={`${fmt(route.sellPrice)} aUEC/SCU`} />
            <Cell label={t("cargo.results.margin")} value={`${fmt(route.marginUnit)} aUEC/SCU`} />
            <Cell label={t("cargo.results.qty")} value={`${fmt(route.quantityScu)} SCU`} />
            <Cell
              label={t("cargo.results.distance")}
              value={route.distanceGm != null ? `${route.distanceGm.toFixed(2)} Gm` : dash}
            />
            <Cell
              label={t("cargo.results.time")}
              value={route.timeMinutes != null ? `${route.timeMinutes.toFixed(1)} ${t("cargo.unit.min")}` : dash}
            />
            <Cell label={t("cargo.detail.profit")} value={`+${fmt(route.profit)} aUEC`} accent="green" />
            <Cell
              label={t("cargo.detail.profitPerMin")}
              value={route.profitPerMinute != null ? `${fmt(route.profitPerMinute)} ${t("cargo.unit.perMin")}` : dash}
              accent="amber"
            />
          </div>
        </section>

        {/* Hiérarchies achat / vente */}
        <section className="px-6 pb-6 pt-5">
          {loading ? (
            <div className="flex items-center gap-2 py-6 text-sm text-white/50">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("cargo.loading")}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <HierarchyColumn title={t("cargo.detail.buyLocation")} data={from} fallback={fromTitle} t={t} />
              <HierarchyColumn title={t("cargo.detail.sellLocation")} data={to} fallback={toTitle} t={t} />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Cell({ label, value, accent }: { label: string; value: string; accent?: "green" | "amber" }) {
  const color = accent === "green" ? "text-emerald-400" : accent === "amber" ? "text-[var(--accent)]" : "text-white";
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.08em] text-white/40">{label}</div>
      <div className={`mt-0.5 text-sm font-semibold ${color}`}>{value}</div>
    </div>
  );
}

function HierarchyColumn({
  title,
  data,
  fallback,
  t,
}: {
  title: string;
  data: LocationHierarchy | null;
  fallback: string;
  t: TFunction;
}) {
  const hasChain = data && data.levels.length > 0;
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-4">
      <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-white/50">{title}</div>

      {hasChain ? (
        <ol className="flex flex-col gap-1.5">
          {/* Système racine */}
          <li className="text-sm text-white/80">
            <span className="text-[11px] uppercase tracking-wide text-white/40">{t("cargo.detail.system")}</span>{" "}
            <span className="font-semibold text-white">{stripSystem(data!.system)}</span>
          </li>
          {data!.levels.map((n, i) => (
            <li key={i} className="flex items-center gap-2" style={{ paddingLeft: `${(i + 1) * 12}px` }}>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-white/25" />
              {n.webUrl ? (
                <button
                  type="button"
                  onClick={() => void openUrl(n.webUrl as string).catch(() => {})}
                  className="group inline-flex items-center gap-1.5 text-sm text-white hover:text-[var(--accent)]"
                  title={t("cargo.detail.openWiki")}
                >
                  <span className="font-medium">{n.name ?? "—"}</span>
                  <ExternalLink className="h-3 w-3 opacity-50 group-hover:opacity-100" />
                </button>
              ) : (
                <span className="text-sm text-white">{n.name ?? "—"}</span>
              )}
              {n.typeClass && (
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium text-white/60">
                  {typeLabel(n.typeClass, t)}
                </span>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <div className="text-sm text-white/70">
          <span className="capitalize">{fallback}</span>
          <p className="mt-1 text-[11px] text-white/40">{t("cargo.detail.noHierarchy")}</p>
        </div>
      )}
    </div>
  );
}
