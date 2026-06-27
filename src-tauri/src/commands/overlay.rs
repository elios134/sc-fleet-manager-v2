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

/* ─────────────────── Raccourci global F6 (hook clavier bas niveau) ─────────────────
   RegisterHotKey (tauri-plugin-global-shortcut) n'est PAS fiable au-dessus d'un jeu
   plein écran + anti-triche : le raccourci ne se déclenche que si l'app a le focus.
   On installe donc un hook WH_KEYBOARD_LL (Windows) dans un thread dédié avec sa
   propre boucle de messages → F6 est capté GLOBALEMENT, même quand SC a le focus.
   La bascule réelle de fenêtre repart sur le thread principal (run_on_main_thread). */

/// Démarre l'écoute globale de F6 (no-op hors Windows).
pub fn spawn_overlay_hotkey(app: AppHandle) {
    #[cfg(windows)]
    hotkey::install(app);
    #[cfg(not(windows))]
    let _ = app;
}

#[cfg(windows)]
mod hotkey {
    use std::sync::OnceLock;
    use tauri::AppHandle;
    use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
    use windows::Win32::UI::Input::KeyboardAndMouse::VK_F6;
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, GetMessageW, SetWindowsHookExW, UnhookWindowsHookEx, HC_ACTION, HHOOK,
        KBDLLHOOKSTRUCT, MSG, WH_KEYBOARD_LL, WM_KEYDOWN, WM_SYSKEYDOWN,
    };

    // Handle de l'app pour atteindre Tauri depuis le callback du hook (extern "system").
    static APP: OnceLock<AppHandle> = OnceLock::new();

    unsafe extern "system" fn ll_hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code == HC_ACTION as i32 {
            let msg = wparam.0 as u32;
            let kb = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
            let pressed = msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN;
            if pressed && kb.vkCode == VK_F6.0 as u32 {
                if let Some(app) = APP.get() {
                    let app2 = app.clone();
                    // La création/affichage de fenêtre DOIT se faire sur le thread principal.
                    let _ = app.run_on_main_thread(move || {
                        let _ = super::toggle_overlay_window(&app2);
                    });
                }
                return LRESULT(1); // F6 dédié à l'overlay → on l'absorbe
            }
        }
        CallNextHookEx(HHOOK::default(), code, wparam, lparam)
    }

    pub fn install(app: AppHandle) {
        let _ = APP.set(app);
        // Thread dédié avec sa propre boucle de messages (requis par WH_KEYBOARD_LL).
        std::thread::spawn(|| unsafe {
            let hook = match SetWindowsHookExW(WH_KEYBOARD_LL, Some(ll_hook), None, 0) {
                Ok(h) => h,
                Err(e) => {
                    eprintln!("[overlay] hook clavier F6 indisponible : {e}");
                    return;
                }
            };
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).as_bool() {}
            let _ = UnhookWindowsHookEx(hook);
        });
    }
}
