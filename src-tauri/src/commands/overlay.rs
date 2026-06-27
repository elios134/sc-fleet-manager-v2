// Phase 2 — Overlay en jeu.
//
// Seconde fenêtre `overlay` : sans bordure, transparente, toujours au-dessus, hors barre
// des tâches, et qui NE prend PAS le focus (ne vole jamais le focus au jeu en plein écran).
// Affiche un HUD sobre (lieu détecté, locations/assurances à échéance) par-dessus Star
// Citizen. Bascule via le raccourci global F6 (cf. main.rs) ou la commande toggle_overlay.
//
// Le contenu est rendu par le même bundle front : main.tsx détecte le label `overlay`
// et affiche OverlayApp au lieu de l'app principale.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

const OVERLAY_LABEL: &str = "overlay";

/// Crée la fenêtre overlay (cachée à l'init). Réutilisée par show/toggle.
fn build_overlay(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    WebviewWindowBuilder::new(app, OVERLAY_LABEL, WebviewUrl::default())
        .title("SCFM Overlay")
        .inner_size(360.0, 480.0)
        .min_inner_size(280.0, 200.0)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false) // ne vole pas le focus au jeu
        .resizable(true)
        .visible(false)
        .build()
        .map_err(|e| e.to_string())
}

/// Bascule la visibilité de l'overlay (le crée au premier appel). Best-effort.
pub fn toggle_overlay_window(app: &AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(OVERLAY_LABEL) {
        let visible = win.is_visible().unwrap_or(false);
        if visible {
            win.hide().map_err(|e| e.to_string())?;
        } else {
            win.show().map_err(|e| e.to_string())?;
            let _ = win.set_always_on_top(true);
        }
    } else {
        let win = build_overlay(app)?;
        win.show().map_err(|e| e.to_string())?;
        let _ = win.set_always_on_top(true);
    }
    Ok(())
}

/// Commande exposée (toggle depuis l'UI, en plus du raccourci F6).
#[tauri::command]
pub fn toggle_overlay(app: AppHandle) -> Result<(), String> {
    toggle_overlay_window(&app)
}

/// Ferme l'overlay (bouton « fermer » du HUD).
#[tauri::command]
pub fn hide_overlay(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(OVERLAY_LABEL) {
        win.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}
