import { createMemoryRouter } from "react-router";
import { Layout } from "../components/Layout";
import FleetPage from "../pages/FleetPage";
import StartPage from "../pages/StartPage";

function StubPage({ title }: { title: string }) {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-white">{title}</h1>
    </div>
  );
}

export const router = createMemoryRouter([
  { path: "/", element: <StartPage /> },
  {
    element: <Layout />,
    children: [
      { path: "fleet", element: <FleetPage /> },
      { path: "ccu-chain", element: <StubPage title="CCU Chain" /> },
      { path: "loadout", element: <StubPage title="Loadout Planner" /> },
      { path: "crafting", element: <StubPage title="Crafting Hub" /> },
      { path: "starmap", element: <StubPage title="Starmap" /> },
      { path: "intel", element: <StubPage title="Mission Intel" /> },
      { path: "items", element: <StubPage title="Items & Cosmetics" /> },
    ],
  },
]);
