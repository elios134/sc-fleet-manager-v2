import { Suspense, lazy, type ReactNode } from "react";
import { createMemoryRouter, Navigate, redirect } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { Loader2 } from "lucide-react";
import { Layout } from "../components/Layout";
import StartPage from "../pages/StartPage";
import { HUBS, hubTabPath } from "./navHubs";

// Pages chargées à la demande (React.lazy) → le bundle initial ne contient que le shell
// (Layout + StartPage) ; le code de chaque page n'est téléchargé/évalué qu'à sa 1re visite.
// Réduit le JS chargé au lancement et l'empreinte mémoire de démarrage.
const SettingsPage = lazy(() => import("../pages/Settings"));
const HomePage = lazy(() => import("../pages/Home"));
const PackDetailPage = lazy(() => import("../pages/PackDetailPage"));
const StarmapPage = lazy(() => import("../pages/StarmapPage"));
const InventoryPage = lazy(() => import("../pages/Inventory"));
const NewsPage = lazy(() => import("../pages/NewsPage"));
const FeaturesPage = lazy(() => import("../pages/FeaturesPage"));
const HubPage = lazy(() => import("../pages/Hub"));

// Hubs à onglets (/hub/onglet) + redirection de chaque ancienne route vers son onglet.
const hubRoutes = HUBS.filter((h) => h.tabs.length > 0).flatMap((h) => [
  { path: `${h.key}/:tab?`, element: page(<HubPage hubKey={h.key} />) },
  ...h.tabs
    .filter((tb) => tb.legacy !== h.path)
    .map((tb) => ({ path: tb.legacy.slice(1), element: <Navigate replace to={hubTabPath(h.key, tb.key)} /> })),
]);

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
      { path: "dashboard", element: page(<HomePage />) },
      { path: "features", element: page(<FeaturesPage />) },
      ...hubRoutes,
      { path: "pack/:pledgeId", element: page(<PackDetailPage />) },
      { path: "inventory", element: page(<InventoryPage />) },
      { path: "starmap", element: page(<StarmapPage />) },
      { path: "news", element: page(<NewsPage />) },
      { path: "settings", element: page(<SettingsPage />) },
    ],
  },
]);
