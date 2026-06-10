use serde_json::{json, Value};
use sqlx::Row;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{webview::WebviewWindowBuilder, AppHandle, Emitter, Manager, WebviewUrl};
use tauri_plugin_sql::{DbInstances, DbPool};

const DB_URL: &str = "sqlite:scfleet.db";
#[allow(dead_code)]
const RSI_ORIGIN: &str = "https://robertsspaceindustries.com";
const CONNECT_URL: &str = "https://robertsspaceindustries.com/connect";
const PLEDGES_URL: &str = "https://robertsspaceindustries.com/en/account/pledges";
const CHROME_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const LOGIN_TIMEOUT_SECS: u64 = 300;

/// Remplace tout caractère non alphanumérique par '_' (pour nommer le data_directory).
fn sanitize_handle(handle: &str) -> String {
    handle
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '_' })
        .collect()
}

/* ─────────────────────────── Helpers AppMeta (sqlx) ──────────────────────── */

async fn meta_get(app: &AppHandle, key: &str) -> Result<Option<String>, String> {
    let instances = app.state::<DbInstances>();
    let lock = instances.0.read().await;
    let db = lock
        .get(DB_URL)
        .ok_or_else(|| format!("Base de données non chargée : {DB_URL}"))?;
    let pool = match db {
        DbPool::Sqlite(pool) => pool,
        #[allow(unreachable_patterns)]
        _ => return Err("Connexion SQLite attendue".into()),
    };
    let row = sqlx::query("SELECT value FROM AppMeta WHERE key = ?")
        .bind(key)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(row.and_then(|r| r.try_get::<String, _>("value").ok()))
}

async fn meta_set(app: &AppHandle, key: &str, value: &str) -> Result<(), String> {
    let instances = app.state::<DbInstances>();
    let lock = instances.0.read().await;
    let db = lock
        .get(DB_URL)
        .ok_or_else(|| format!("Base de données non chargée : {DB_URL}"))?;
    let pool = match db {
        DbPool::Sqlite(pool) => pool,
        #[allow(unreachable_patterns)]
        _ => return Err("Connexion SQLite attendue".into()),
    };
    sqlx::query("INSERT OR REPLACE INTO AppMeta (key, value) VALUES (?, ?)")
        .bind(key)
        .bind(value)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

async fn meta_delete_keys(app: &AppHandle, keys: &[String]) -> Result<(), String> {
    let instances = app.state::<DbInstances>();
    let lock = instances.0.read().await;
    let db = lock
        .get(DB_URL)
        .ok_or_else(|| format!("Base de données non chargée : {DB_URL}"))?;
    let pool = match db {
        DbPool::Sqlite(pool) => pool,
        #[allow(unreachable_patterns)]
        _ => return Err("Connexion SQLite attendue".into()),
    };
    for k in keys {
        sqlx::query("DELETE FROM AppMeta WHERE key = ?")
            .bind(k)
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Écriture synchrone des tokens (appelée depuis un thread OS sans contexte async).
fn store_rsi_tokens_sync(
    app: &AppHandle,
    handle: &str,
    csrf: &str,
    token: &str,
    portrait: &str,
) -> Result<(), String> {
    tauri::async_runtime::block_on(async {
        meta_set(app, &format!("rsi.csrf.{handle}"), csrf).await?;
        meta_set(app, &format!("rsi.token.{handle}"), token).await?;
        if !portrait.is_empty() {
            meta_set(app, &format!("rsi.portrait.{handle}"), portrait).await?;
        }
        Ok::<(), String>(())
    })
}

/// Évalue un JS qui retourne une string, et déballe le résultat JSON-sérialisé.
/// (eval_with_callback renvoie la valeur sérialisée en JSON, ex. "\"abc\"".)
fn eval_string(win: &tauri::WebviewWindow, js: &str) -> String {
    let (tx, rx) = std::sync::mpsc::channel();
    if win
        .eval_with_callback(js, move |v| {
            let _ = tx.send(v);
        })
        .is_err()
    {
        return String::new();
    }
    let raw = rx
        .recv_timeout(Duration::from_secs(5))
        .unwrap_or_default();
    serde_json::from_str::<String>(&raw).unwrap_or(raw)
}

/* ──────────────────────────────  open_rsi_login  ─────────────────────────── */

#[tauri::command]
pub fn open_rsi_login(handle: String, app: AppHandle) -> Result<(), String> {
    // 1. data_directory par compte.
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let data_dir = base.join("rsi").join(sanitize_handle(&handle));
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;

    // Ferme une éventuelle fenêtre de login résiduelle (même label).
    if let Some(existing) = app.get_webview_window("rsi-login") {
        let _ = existing.close();
    }

    // 3. Channel de résultat partagé avec le thread de timeout.
    let result: Arc<Mutex<Option<Result<(String, String), String>>>> = Arc::new(Mutex::new(None));
    let handled = Arc::new(AtomicBool::new(false));

    let app_nav = app.clone();
    let handle_nav = handle.clone();
    let result_nav = result.clone();
    let handled_nav = handled.clone();

    // 2 + 4. Construit la fenêtre visible et enregistre on_navigation AU NIVEAU DU
    // BUILDER (on_navigation n'existe pas sur la WebviewWindow construite). Le
    // handler récupère la fenêtre via app.get_webview_window pour l'eval.
    let url = CONNECT_URL
        .parse()
        .map_err(|_| "URL de connexion invalide".to_string())?;
    let _win = WebviewWindowBuilder::new(&app, "rsi-login", WebviewUrl::External(url))
        .title("RSI Login — SC Fleet Manager")
        .inner_size(1024.0, 768.0)
        .center()
        .user_agent(CHROME_UA)
        .data_directory(data_dir)
        .on_navigation(move |url| {
            let url_str = url.to_string();
            if url_str.contains("/en/account/pledges") || url_str.contains("/account/pledges") {
                // Garde anti double-traitement (on_navigation peut refirer).
                if handled_nav.swap(true, Ordering::SeqCst) {
                    return true;
                }
                let app_t = app_nav.clone();
                let handle_t = handle_nav.clone();
                let result_t = result_nav.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(1500));
                    let Some(win_eval) = app_t.get_webview_window("rsi-login") else {
                        return;
                    };

                    let csrf = eval_string(
                        &win_eval,
                        "document.querySelector('meta[name=\"csrf-token\"]')?.getAttribute('content') ?? ''",
                    );
                    let rsi_token = eval_string(
                        &win_eval,
                        "(document.cookie.match(/(?:^|; )Rsi-Token=([^;]+)/) || [])[1] ?? ''",
                    );
                    let portrait = eval_string(
                        &win_eval,
                        "document.querySelector('.profile-photo img, .account-avatar img, [class*=\"avatar\"] img')?.src ?? ''",
                    );

                    if !csrf.is_empty() && !rsi_token.is_empty() {
                        let _ = store_rsi_tokens_sync(&app_t, &handle_t, &csrf, &rsi_token, &portrait);
                        let _ = app_t.emit(
                            "rsi:login-success",
                            json!({ "handle": handle_t, "hasPortrait": !portrait.is_empty() }),
                        );
                        *result_t.lock().unwrap() = Some(Ok((csrf, rsi_token)));
                    } else {
                        let _ = app_t.emit("rsi:login-error", json!({ "reason": "tokens_not_found" }));
                        *result_t.lock().unwrap() =
                            Some(Err("Tokens non trouvés après login".to_string()));
                    }

                    let _ = win_eval.close();
                });
            }
            true // autorise toujours la navigation
        })
        .build()
        .map_err(|e| e.to_string())?;

    // 5. Thread de timeout : ferme la fenêtre + émet rsi:login-timeout si rien après LOGIN_TIMEOUT_SECS.
    let app_to = app.clone();
    let result_to = result.clone();
    std::thread::spawn(move || {
        for _ in 0..LOGIN_TIMEOUT_SECS {
            std::thread::sleep(Duration::from_secs(1));
            if result_to.lock().unwrap().is_some() {
                return;
            }
        }
        if result_to.lock().unwrap().is_none() {
            if let Some(w) = app_to.get_webview_window("rsi-login") {
                let _ = w.close();
            }
            let _ = app_to.emit("rsi:login-timeout", json!({ "reason": "timeout" }));
        }
    });

    Ok(())
}

/* ─────────────────────────────  check_rsi_session  ───────────────────────── */

#[tauri::command]
pub async fn check_rsi_session(handle: String, app: AppHandle) -> Result<bool, String> {
    // 1. Pas de token → pas de session.
    if meta_get(&app, &format!("rsi.token.{handle}")).await?.is_none() {
        return Ok(false);
    }

    // 2. Fenêtre cachée, même data_directory.
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let data_dir = base.join("rsi").join(sanitize_handle(&handle));
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;

    if let Some(existing) = app.get_webview_window("rsi-session-check") {
        let _ = existing.close();
    }

    let url = PLEDGES_URL
        .parse()
        .map_err(|_| "URL pledges invalide".to_string())?;
    let win = WebviewWindowBuilder::new(&app, "rsi-session-check", WebviewUrl::External(url))
        .visible(false)
        .inner_size(900.0, 700.0)
        .user_agent(CHROME_UA)
        .data_directory(data_dir)
        .build()
        .map_err(|e| e.to_string())?;

    // 4. Settle.
    tokio::time::sleep(Duration::from_secs(4)).await;

    let current = win.url().map(|u| u.to_string()).unwrap_or_default();
    // 6. Ferme la fenêtre dans tous les cas.
    let _ = win.close();

    // 5. Décision.
    if current.contains("/account/pledges") {
        let _ = app.emit("rsi:session-valid", json!({ "handle": handle }));
        Ok(true)
    } else if current.contains("connect") || current.contains("login") {
        let _ = meta_delete_keys(
            &app,
            &[
                format!("rsi.csrf.{handle}"),
                format!("rsi.token.{handle}"),
                format!("rsi.portrait.{handle}"),
            ],
        )
        .await;
        Ok(false)
    } else {
        Ok(false)
    }
}

/* ───────────────────────────  get_rsi_session_status  ────────────────────── */

#[tauri::command]
pub async fn get_rsi_session_status(handle: String, app: AppHandle) -> Result<Value, String> {
    let token = meta_get(&app, &format!("rsi.token.{handle}")).await?;
    let portrait = meta_get(&app, &format!("rsi.portrait.{handle}")).await?;
    Ok(json!({
        "hasToken": token.is_some(),
        "portraitUrl": portrait,
    }))
}

/* ────────────────────────────────  logout_rsi  ───────────────────────────── */

#[tauri::command]
pub async fn logout_rsi(handle: String, app: AppHandle) -> Result<(), String> {
    meta_delete_keys(
        &app,
        &[
            format!("rsi.csrf.{handle}"),
            format!("rsi.token.{handle}"),
            format!("rsi.portrait.{handle}"),
        ],
    )
    .await?;
    let _ = app.emit("rsi:logout", json!({ "handle": handle }));
    Ok(())
}
