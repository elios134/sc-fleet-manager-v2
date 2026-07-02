import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import type { StarmapBodyItem } from "../components/starmap3d/starmapData";

// Vue 3D (Three.js) chargée en lazy pour ne pas alourdir le démarrage.
const Starmap3D = lazy(() => import("../components/starmap3d/Starmap3D"));

export default function StarmapPage() {
  const { t } = useTranslation();
  const [bodies, setBodies] = useState<StarmapBodyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [system, setSystem] = useState<string>("");

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

  const systems = useMemo(
    () => [...new Set(bodies.map((b) => b.systemName))].filter(Boolean),
    [bodies],
  );

  // Système par défaut : celui qui contient une étoile, sinon le premier.
  useEffect(() => {
    if (system || systems.length === 0) return;
    const withStar = bodies.find((b) => b.navIcon === "Star")?.systemName;
    setSystem(withStar ?? systems[0]);
  }, [bodies, systems, system]);

  return (
    <div className="flex h-full flex-col gap-3 p-6">
      <header className="flex shrink-0 flex-wrap items-baseline gap-3">
        <p className="text-xs uppercase tracking-[0.18em] text-white/40">{t("starmap.subtitle")}</p>
        <h1 className="text-2xl font-bold text-white">{t("starmap.title")}</h1>
        {!loading && !error && (
          <span className="text-[11px] tabular-nums text-white/40">
            {t("starmap.bodiesAndSystems", {
              n: bodies.length,
              systems: systems.map((s) => s.toUpperCase()).join(" / "),
            })}
          </span>
        )}

        {!loading && !error && bodies.length > 0 && systems.length > 1 && (
          <select
            value={system}
            onChange={(e) => setSystem(e.target.value)}
            className="ml-auto rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-xs text-white focus:outline-none"
          >
            {systems.map((s) => (
              <option key={s} value={s}>
                {s.toUpperCase()}
              </option>
            ))}
          </select>
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
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center gap-2 text-white/50">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("starmap.loading3d")}
              </div>
            }
          >
            <Starmap3D bodies={bodies} system={system} />
          </Suspense>
        </div>
      )}
    </div>
  );
}
