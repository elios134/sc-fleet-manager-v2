use serde_json::{json, Value};
use sqlx::Row;
use std::sync::mpsc;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tauri_plugin_sql::{DbInstances, DbPool};

const DB_URL: &str = "sqlite:scfleet.db";
/// URL de destination ouverte par le JS (référence ; la fenêtre est créée côté JS).
#[allow(dead_code)]
const RSI_PLEDGES_URL: &str = "https://robertsspaceindustries.com/en/account/pledges";
/// Origine utilisée pour interroger le cookie store de la webview.
const RSI_ORIGIN: &str = "https://robertsspaceindustries.com";

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

/* ───────────────────────────── Helper eval DOM ───────────────────────────── */

/// Évalue un JS qui retourne une string dans la page de la webview et déballe le
/// résultat (eval_with_callback renvoie la valeur sérialisée en JSON, ex. "\"abc\"").
///
/// Exécuté dans un thread bloquant dédié : sur Windows WebView2, `eval_with_callback`
/// et la lecture de cookies se bloquent (deadlock) si appelés depuis le thread
/// principal. La commande étant `async` (hors thread principal) + `spawn_blocking`,
/// le `recv` n'interbloque pas la boucle d'évènements.
async fn eval_dom_string(win: tauri::WebviewWindow, js: &'static str) -> String {
    tauri::async_runtime::spawn_blocking(move || {
        let (tx, rx) = mpsc::channel::<String>();
        if win
            .eval_with_callback(js, move |v| {
                let _ = tx.send(v);
            })
            .is_err()
        {
            return String::new();
        }
        let raw = rx.recv_timeout(Duration::from_secs(5)).unwrap_or_default();
        serde_json::from_str::<String>(&raw).unwrap_or(raw)
    })
    .await
    .unwrap_or_default()
}

/* ───────────────────────────  check_rsi_login_status  ─────────────────────── */

/// Appelée en polling depuis le JS tant que la fenêtre `rsi-login` est ouverte.
/// Ne crée aucune fenêtre : observe l'URL courante et l'état des cookies.
#[tauri::command]
pub async fn check_rsi_login_status(app: AppHandle) -> Result<Value, String> {
    // 1. Fenêtre absente → l'utilisateur l'a fermée.
    let Some(win) = app.get_webview_window("rsi-login") else {
        return Ok(json!({ "status": "closed" }));
    };

    // 2. URL courante.
    let url = win.url().map_err(|e| e.to_string())?;
    let url_str = url.as_str().to_string();
    let is_login_page = url_str.contains("/connect")
        || url_str.contains("/login")
        || url_str.contains("/signin");
    let is_blank = url_str.is_empty() || url_str.contains("about:blank");

    // 3. Présence d'un Rsi-Token valide.
    let has_token = {
        let origin = tauri::Url::parse(RSI_ORIGIN).map_err(|e| e.to_string())?;
        match win.cookies_for_url(origin) {
            Ok(cookies) => cookies
                .iter()
                .any(|c| c.name() == "Rsi-Token" && !c.value().is_empty()),
            Err(_) => false,
        }
    };

    // 4. Détection renforcée : "logged_in" SEULEMENT si on est sur /account/pledges,
    //    hors page de login, hors about:blank, ET qu'un Rsi-Token est présent. Évite
    //    les faux positifs (état transitoire) et fermeture prématurée de la fenêtre.
    if url_str.contains("/account/pledges") && !is_login_page && !is_blank && has_token {
        return Ok(json!({ "status": "logged_in", "hasToken": true }));
    }
    if is_login_page {
        return Ok(json!({ "status": "waiting_login" }));
    }
    Ok(json!({ "status": "loading", "url": url_str }))
}

/* ─────────────────────  extract_and_store_rsi_session  ────────────────────── */

/// Appelée par le JS quand `check_rsi_login_status` retourne "logged_in".
/// Extrait le token (cookie HttpOnly, lisible seulement côté Rust), le csrf-token
/// et le portrait depuis le DOM, puis stocke le tout en AppMeta.
#[tauri::command]
pub async fn extract_and_store_rsi_session(
    handle: String,
    app: AppHandle,
) -> Result<Value, String> {
    let win = app
        .get_webview_window("rsi-login")
        .ok_or_else(|| "Fenêtre rsi-login absente".to_string())?;

    // 1. Cookies RSI (inclut les HttpOnly, en clair via le store webview).
    let origin = tauri::Url::parse(RSI_ORIGIN).map_err(|e| e.to_string())?;
    let cookies = win.cookies_for_url(origin).map_err(|e| e.to_string())?;

    // 2. Token obligatoire.
    let token = cookies
        .iter()
        .find(|c| c.name() == "Rsi-Token")
        .map(|c| c.value().to_string())
        .ok_or_else(|| "Rsi-Token introuvable".to_string())?;

    // 3. En-tête Cookie complet (pour reqwest plus tard).
    let cookie_header = cookies
        .iter()
        .map(|c| format!("{}={}", c.name(), c.value()))
        .collect::<Vec<_>>()
        .join("; ");

    // 4. csrf-token depuis le DOM (try/catch car exceptions avalées sur Windows).
    let csrf = eval_dom_string(
        win.clone(),
        "(function(){ try { return document.querySelector('meta[name=\"csrf-token\"]')?.getAttribute('content') || ''; } catch(e){ return ''; } })()",
    )
    .await;

    // 5. Portrait depuis le DOM.
    let portrait = eval_dom_string(
        win.clone(),
        "(function(){ try { return document.querySelector('.account-profile img, [class*=\"avatar\"] img')?.src || ''; } catch(e){ return ''; } })()",
    )
    .await;

    // 6. Stockage AppMeta.
    meta_set(&app, &format!("rsi.token.{handle}"), &token).await?;
    meta_set(&app, &format!("rsi.csrf.{handle}"), &csrf).await?;
    if !portrait.is_empty() {
        meta_set(&app, &format!("rsi.portrait.{handle}"), &portrait).await?;
    }
    meta_set(&app, &format!("rsi.cookies.{handle}"), &cookie_header).await?;

    Ok(json!({ "success": true, "hasPortrait": !portrait.is_empty() }))
}

/* ─────────────────────────────  extract_rsi_handle  ──────────────────────── */

/// Script d'extraction du handle RSI depuis le DOM de la page `/account/pledges`
/// (sélecteurs confirmés sur DOM réel) :
///   1. span[data-cy-id="handleName"] → textContent "@elios5" (retire le @)
///   2. a[data-cy-id="citizenDossier"] (ou tout a[href*="/citizens/"]) → segment après /citizens/
const HANDLE_SCRIPT: &str = r#"(function(){
  try {
    var el = document.querySelector('[data-cy-id="handleName"]');
    if (el && el.textContent) {
      var h = el.textContent.trim().replace(/^@/, '');
      if (h) return h;
    }
    var link = document.querySelector('a[data-cy-id="citizenDossier"]') || document.querySelector('a[href*="/citizens/"]');
    if (link) {
      var href = link.getAttribute('href') || '';
      var m = href.match(/\/citizens\/([^\/?#]+)/);
      if (m && m[1]) return m[1];
    }
    return '';
  } catch(e){ return ''; }
})()"#;

/// Extrait le handle RSI depuis la webview `rsi-login` connectée (login direct,
/// où le handle n'est pas connu d'avance). Les éléments n'apparaissent qu'après
/// chargement complet → on réessaie jusqu'à 5 fois avec 1 s de pause. None si vide.
#[tauri::command]
pub async fn extract_rsi_handle(app: AppHandle) -> Result<Option<String>, String> {
    let win = app
        .get_webview_window("rsi-login")
        .ok_or_else(|| "Fenêtre rsi-login absente".to_string())?;

    for attempt in 0..5 {
        if attempt > 0 {
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
        let handle = eval_dom_string(win.clone(), HANDLE_SCRIPT).await;
        let handle = handle.trim().trim_start_matches('@').trim().to_string();
        if !handle.is_empty() {
            return Ok(Some(handle));
        }
    }
    Ok(None)
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
    // Suppression des tokens AppMeta. Le vidage des cookies WebView est fait
    // séparément par `clear_rsi_cookies`, déclenché côté JS sur une fenêtre
    // fonctionnelle (les WebView créées en Rust étant non fonctionnelles ici).
    meta_delete_keys(
        &app,
        &[
            format!("rsi.token.{handle}"),
            format!("rsi.csrf.{handle}"),
            format!("rsi.portrait.{handle}"),
            format!("rsi.cookies.{handle}"),
        ],
    )
    .await
}

/// Vide le profil WebView2 partagé (cookies RSI inclus) via `clear_all_browsing_data`
/// sur une fenêtre **existante** désignée par `label`. La fenêtre doit avoir été créée
/// côté JS (seule voie fonctionnelle ici). Toutes les WebView de l'app partagent le
/// même profil par défaut (aucun `dataDirectory`), donc vider via n'importe laquelle
/// purge les cookies RSI partagés — équivalent du `session.clearStorageData()` V1.
#[tauri::command]
pub async fn clear_rsi_cookies(label: String, app: AppHandle) -> Result<(), String> {
    let win = app
        .get_webview_window(&label)
        .ok_or_else(|| format!("Fenêtre {label} absente"))?;
    win.clear_all_browsing_data().map_err(|e| e.to_string())
}
