import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import StarmapCanvas, { type StarmapBodyItem } from "../components/StarmapCanvas";

export default function StarmapPage() {
  const { t } = useTranslation();
  const [bodies, setBodies] = useState<StarmapBodyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    invoke<StarmapBodyItem[]>("get_starmap_bodies")
      .then((data) => {
        if (!cancelled) setBodies(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const systems = [...new Set(bodies.map((b) => b.systemName))].map((s) => s.toUpperCase());

  return (
    <div className="flex h-full flex-col gap-3 p-6">
      <header className="flex shrink-0 items-baseline gap-3">
        <p className="text-xs uppercase tracking-[0.18em] text-white/40">{t("starmap.subtitle")}</p>
        <h1 className="text-2xl font-bold text-white">{t("starmap.title")}</h1>
        {!loading && !error && (
          <span className="text-[11px] tabular-nums text-white/40">
            {t("starmap.bodiesAndSystems", { n: bodies.length, systems: systems.join(" / ") })}
          </span>
        )}
      </header>

      {loading ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-white/50">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("starmap.loadingMap")}
        </div>
      ) : error ? (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          {t("common.errorPrefix")} {error}
        </p>
      ) : bodies.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/15 bg-white/5 p-10 text-center text-white/70">
          {t("starmap.emptyMap")}
        </div>
      ) : (
        <div className="min-h-0 flex-1">
          <StarmapCanvas bodies={bodies} height="100%" />
        </div>
      )}
    </div>
  );
}
