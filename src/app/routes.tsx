import { Suspense, lazy, type ReactNode } from "react";
import { createMemoryRouter, redirect } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { Loader2 } from "lucide-react";
import { Layout } from "../components/Layout";
import StartPage from "../pages/StartPage";

// Pages chargées à la demande (React.lazy) → le bundle initial ne contient que le shell
// (Layout + StartPage) ; le code de chaque page n'est téléchargé/évalué qu'à sa 1re visite.
// Réduit le JS chargé au lancement et l'empreinte mémoire de démarrage.
const FleetPage = lazy(() => import("../pages/Fleet"));
const SettingsPage = lazy(() => import("../pages/Settings"));
const DashboardPage = lazy(() => import("../pages/Dashboard"));
const CcuChainPage = lazy(() => import("../pages/CcuChain"));
const MissionHubPage = lazy(() => import("../pages/MissionHubPage"));
const CraftingHubPage = lazy(() => import("../pages/CraftingHub"));
const ComparatorPage = lazy(() => import("../pages/ComparatorPage"));
const LoadoutPage = lazy(() => import("../pages/Loadout"));
const ItemsCosmeticsPage = lazy(() => import("../pages/Items"));
const PackDetailPage = lazy(() => import("../pages/PackDetailPage"));
const InsurancePage = lazy(() => import("../pages/InsurancePage"));
const StarmapPage = lazy(() => import("../pages/StarmapPage"));
const CargoRoutesPage = lazy(() => import("../pages/CargoRoutes"));
const MiningPage = lazy(() => import("../pages/Mining"));
const JournalPage = lazy(() => import("../pages/Journal"));
const CataloguePage = lazy(() => import("../pages/CataloguePage"));
const NewsPage = lazy(() => import("../pages/NewsPage"));
const HangarExecPage = lazy(() => import("../pages/HangarExecPage"));
const FeaturesPage = lazy(() => import("../pages/FeaturesPage"));
const Ship3DPage = lazy(() => import("../pages/Ship3D"));
const OverlayPage = lazy(() => import("../pages/Overlay"));

// Voile de chargement neutre pendant le fetch du chunk de page (transitions rapides).
function page(node: ReactNode) {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center text-white/40">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      }
    >
      {node}
    </Suspense>
  );
}

// Au chargement de "/", redirige vers /dashboard si un compte est actif,
// sinon affiche la StartPage.
async function rootLoader() {
  try {
    const activeId = await invoke<string | null>("get_active_account_id");
    if (activeId) return redirect("/dashboard");
  } catch {
    /* DB pas encore prête : on retombe sur la StartPage */
  }
  return null;
}

export const router = createMemoryRouter([
  { path: "/", loader: rootLoader, element: <StartPage /> },
  {
    element: <Layout />,
    children: [
      { path: "dashboard", element: page(<DashboardPage />) },
      { path: "features", element: page(<FeaturesPage />) },
      { path: "fleet", element: page(<FleetPage />) },
      { path: "pack/:pledgeId", element: page(<PackDetailPage />) },
      { path: "ccu-chain", element: page(<CcuChainPage />) },
      { path: "loadout", element: page(<LoadoutPage />) },
      { path: "comparator", element: page(<ComparatorPage />) },
      { path: "ship3d", element: page(<Ship3DPage />) },
      { path: "overlay", element: page(<OverlayPage />) },
      { path: "crafting", element: page(<CraftingHubPage />) },
      { path: "cargo-routes", element: page(<CargoRoutesPage />) },
      { path: "mining", element: page(<MiningPage />) },
      { path: "catalogue", element: page(<CataloguePage />) },
      { path: "news", element: page(<NewsPage />) },
      { path: "hangar-exec", element: page(<HangarExecPage />) },
      { path: "starmap", element: page(<StarmapPage />) },
      { path: "intel", element: page(<MissionHubPage />) },
      { path: "journal", element: page(<JournalPage />) },
      { path: "items", element: page(<ItemsCosmeticsPage />) },
      { path: "insurance", element: page(<InsurancePage />) },
      { path: "settings", element: page(<SettingsPage />) },
    ],
  },
]);
