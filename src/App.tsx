import { RouterProvider } from "react-router";
import { router } from "./app/routes";
import { useAppSettings } from "./hooks/useAppSettings";
import { TitleBar } from "./components/TitleBar";

function App() {
  useAppSettings();
  // Barre de titre globale (une seule fois) au-dessus du routeur : présente sur
  // toutes les routes, StartPage incluse. Le reste de l'app s'affiche dessous.
  return (
    <div className="relative flex h-screen w-screen flex-col overflow-hidden">
      {/* Fond global derrière la barre de titre ET le contenu : sans lui, la TitleBar
          transparente laisse voir le #0a0a0f du body (bande noire). Même dégradé que
          le Layout ; les pages redessinent leur fond opaque par-dessus dans leur zone. */}
      <div
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background:
            "radial-gradient(ellipse at 20% 50%, var(--bg-glow-1, rgba(99,102,241,0.15)) 0%, transparent 60%), radial-gradient(ellipse at 80% 20%, var(--bg-glow-2, rgba(139,92,246,0.10)) 0%, transparent 50%), #0a0a0f",
        }}
      />
      <TitleBar />
      <div className="relative z-10 min-h-0 flex-1">
        <RouterProvider router={router} />
      </div>
    </div>
  );
}

export default App;
