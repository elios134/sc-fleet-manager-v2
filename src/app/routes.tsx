import { createMemoryRouter, redirect } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { Layout } from "../components/Layout";
import FleetPage from "../pages/FleetPage";
import StartPage from "../pages/StartPage";
import SettingsPage from "../pages/SettingsPage";
import DashboardPage from "../pages/DashboardPage";
import CcuChainPage from "../pages/CcuChainPage";
import MissionIntelPage from "../pages/MissionIntelPage";
import CraftingHubPage from "../pages/CraftingHubPage";

function StubPage({ title }: { title: string }) {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-white">{title}</h1>
    </div>
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
      { path: "dashboard", element: <DashboardPage /> },
      { path: "fleet", element: <FleetPage /> },
      { path: "ccu-chain", element: <CcuChainPage /> },
      { path: "loadout", element: <StubPage title="Loadout Planner" /> },
      { path: "crafting", element: <CraftingHubPage /> },
      { path: "starmap", element: <StubPage title="Starmap" /> },
      { path: "intel", element: <MissionIntelPage /> },
      { path: "items", element: <StubPage title="Items & Cosmetics" /> },
      { path: "settings", element: <SettingsPage /> },
    ],
  },
]);
