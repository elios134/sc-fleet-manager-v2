import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { Loader2, Box, Grid2x2 } from "lucide-react";
import StarmapCanvas, { type StarmapBodyItem } from "../components/StarmapCanvas";

// Phase 3 — la vue 3D (Three.js) est lourde : chargée en lazy pour ne pas alourdir
// le démarrage. Elle n'est montée que lorsque l'utilisateur bascule en mode 3D.
const Starmap3D = lazy(() => import("../components/Starmap3D"));

export default function StarmapPage() {
  const { t } = useTranslation();
  const [bodies, setBodies] = useState<StarmapBodyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"2d" | "3d">("2d");
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

        {!loading && !error && bodies.length > 0 && (
          <div className="ml-auto flex items-center gap-2">
            {view === "3d" && systems.length > 1 && (
              <select
                value={system}
                onChange={(e) => setSystem(e.target.value)}
                className="rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-xs text-white focus:outline-none"
              >
                {systems.map((s) => (
                  <option key={s} value={s}>
                    {s.toUpperCase()}
                  </option>
                ))}
              </select>
            )}
            <div className="flex overflow-hidden rounded-lg border border-white/10">
              <button
                onClick={() => setView("2d")}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium ${
                  view === "2d" ? "bg-[var(--accent)] text-black" : "bg-white/5 text-white/70"
                }`}
              >
                <Grid2x2 className="h-3.5 w-3.5" /> {t("starmap.view2d")}
              </button>
              <button
                onClick={() => setView("3d")}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium ${
                  view === "3d" ? "bg-[var(--accent)] text-black" : "bg-white/5 text-white/70"
                }`}
              >
                <Box className="h-3.5 w-3.5" /> {t("starmap.view3d")}
              </button>
            </div>
          </div>
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
      ) : view === "2d" ? (
        <div className="min-h-0 flex-1">
          <StarmapCanvas bodies={bodies} height="100%" />
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
