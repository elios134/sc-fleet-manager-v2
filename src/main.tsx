import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import OverlayApp from "./OverlayApp";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./i18n"; // init i18next (avant le rendu)
import "./styles/index.css";

// DEV uniquement, et seulement hors bundle Tauri : installe un mock Tauri pour que
// l'UI se rende dans un simple navigateur (revue visuelle vs maquette). No-op en prod
// et dès qu'un vrai __TAURI_INTERNALS__ est présent.
if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) {
  const { installTauriBrowserMock } = await import("./lib/tauriBrowserMock");
  installTauriBrowserMock();
}

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
