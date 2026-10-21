// Page « hub » générique : pastilles d'onglets (en verre) + page existante de l'onglet actif.
// L'onglet est dans l'URL (/hub/onglet) ; dans « Vaisseaux », le ?ship= suit d'un onglet à l'autre.
import { Suspense, lazy, type ComponentType, type LazyExoticComponent } from "react";
import { Navigate, NavLink, useLocation, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { HUBS, hubTabPath } from "../../app/navHubs";

const TAB_PAGES: Record<string, LazyExoticComponent<ComponentType>> = {
  "fleet/ma-flotte": lazy(() => import("../Fleet")),
  "fleet/assurances": lazy(() => import("../Insurance")),
  "fleet/ccu": lazy(() => import("../CcuChain")),
  "ships/configurateur": lazy(() => import("../Loadout")),
  "ships/comparateur": lazy(() => import("../Comparator")),
  "ships/3d": lazy(() => import("../Ship3D")),
  "missions/hub": lazy(() => import("../MissionHub")),
  "missions/carnet": lazy(() => import("../Journal")),
  "commerce/cargo": lazy(() => import("../CargoRoutes")),
  "commerce/hangar-exec": lazy(() => import("../HangarExecPage")),
  "industry/minage": lazy(() => import("../Mining")),
  "industry/crafting": lazy(() => import("../CraftingHub")),
  "market/objets": lazy(() => import("../CataloguePage")),
  "market/cosmetiques": lazy(() => import("../Items")),
  "tools/traduction": lazy(() => import("../Translation")),
  "tools/overlay": lazy(() => import("../Overlay")),
};

export default function HubPage({ hubKey }: { hubKey: string }) {
  const { t } = useTranslation();
  const { tab } = useParams();
  const { search } = useLocation();
  const hub = HUBS.find((h) => h.key === hubKey);
  if (!hub || hub.tabs.length === 0) return <Navigate to="/dashboard" replace />;
  const current = hub.tabs.find((x) => x.key === tab) ?? hub.tabs[0];
  if (tab !== current.key) return <Navigate to={hubTabPath(hub.key, current.key) + search} replace />;
  const Page = TAB_PAGES[`${hub.key}/${current.key}`];
  const keepSearch = hub.key === "ships" ? search : "";

  return (
    <div className="flex h-full flex-col">
      <nav aria-label={t(hub.labelKey)} className="flex shrink-0 items-center gap-3 px-6 pt-4">
        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-white/40">{t(hub.labelKey)}</span>
        <div className="glass inline-flex gap-1 rounded-full p-1">
          {hub.tabs.map((x) => (
            <NavLink
              key={x.key}
              to={hubTabPath(hub.key, x.key) + keepSearch}
              className={({ isActive }) =>
                [
                  "rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors",
                  isActive ? "bg-[var(--accent)] text-white" : "text-white/60 hover:text-white",
                ].join(" ")
              }
            >
              {t(x.labelKey)}
            </NavLink>
          ))}
        </div>
      </nav>
      <div className="min-h-0 flex-1">
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center text-white/40">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          }
        >
          {Page ? <Page /> : null}
        </Suspense>
      </div>
    </div>
  );
}
