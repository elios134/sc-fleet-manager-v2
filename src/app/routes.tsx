import { createMemoryRouter, redirect } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { Layout } from "../components/Layout";
import FleetPage from "../pages/FleetPage";
import StartPage from "../pages/StartPage";
import SettingsPage from "../pages/SettingsPage";
import DashboardPage from "../pages/DashboardPage";
import CcuChainPage from "../pages/CcuChainPage";
import MissionHubPage from "../pages/MissionHubPage";
import CraftingHubPage from "../pages/CraftingHubPage";
import ComparatorPage from "../pages/ComparatorPage";
import LoadoutPage from "../pages/LoadoutPage";
import ItemsCosmeticsPage from "../pages/ItemsCosmeticsPage";
import PackDetailPage from "../pages/PackDetailPage";
import InsurancePage from "../pages/InsurancePage";
import StarmapPage from "../pages/StarmapPage";
import CargoRoutesPage from "../pages/CargoRoutesPage";
import JournalPage from "../pages/JournalPage";
import CataloguePage from "../pages/CataloguePage";

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
      { path: "pack/:pledgeId", element: <PackDetailPage /> },
      { path: "ccu-chain", element: <CcuChainPage /> },
      { path: "loadout", element: <LoadoutPage /> },
      { path: "comparator", element: <ComparatorPage /> },
      { path: "crafting", element: <CraftingHubPage /> },
      { path: "cargo-routes", element: <CargoRoutesPage /> },
      { path: "catalogue", element: <CataloguePage /> },
      { path: "starmap", element: <StarmapPage /> },
      { path: "intel", element: <MissionHubPage /> },
      { path: "journal", element: <JournalPage /> },
      { path: "items", element: <ItemsCosmeticsPage /> },
      { path: "insurance", element: <InsurancePage /> },
      { path: "settings", element: <SettingsPage /> },
    ],
  },
]);
