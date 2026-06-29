import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import OverlayApp from "./OverlayApp";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./i18n"; // init i18next (avant le rendu)
import "./styles/index.css";

// Phase 2 — la fenêtre `overlay` partage le même bundle : on détecte son label et on
// rend le HUD léger (OverlayApp) au lieu de l'application principale.
function currentWindowLabel(): string {
  try {
    // getCurrentWindow() est synchrone en Tauri 2 ; import paresseux pour ne pas
    // casser un éventuel rendu hors-Tauri.

    const w = window as unknown as {
      __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } };
    };
    return w.__TAURI_INTERNALS__?.metadata?.currentWindow?.label ?? "main";
  } catch {
    return "main";
  }
}

const isOverlay = currentWindowLabel() === "overlay";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>{isOverlay ? <OverlayApp /> : <App />}</ErrorBoundary>
  </React.StrictMode>,
);
