use serde_json::{json, Value};
use sqlx::Row;
use std::sync::mpsc;
use std::time::Duration;
use tauri::webview::Cookie;
use tauri::{AppHandle, Manager};
use tauri_plugin_sql::{DbInstances, DbPool};

use crate::DB_URL;
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

/// Script DOM unique : renvoie 3 caractères "abc" où
///   a = liste pledges réellement chargée (pas juste la coquille),
///   b = message "session has expired" présent,
///   c = marqueur hangar vide ".empy-list" présent (orthographe RSI réelle, une seule "t" ;
///       même sélecteur que rsi_scrape.rs POLL_SCRIPT). Un compte sans flotte est aussi
///       "prêt" : sans ça, logged_in ne passait jamais → timeout 5 min.
const LOGIN_STATE_SCRIPT: &str = r#"(function(){
  try {
    var hasPledges = !!document.querySelector('.content-wrapper.content-block1.pledges ul.list-items');
    var hasEmpty = !!document.querySelector('.empy-list');
    var expired = !!(document.body && document.body.textContent && document.body.textContent.toLowerCase().includes('session has expired'));
    return (hasPledges?'1':'0') + (expired?'1':'0') + (hasEmpty?'1':'0');
  } catch(e){ return '000'; }
})()"#;

/// Appelée en polling depuis le JS tant que la fenêtre `rsi-login` est ouverte.
/// "logged_in" dès que : URL /account/pledges (hors login/blank) + Rsi-Token valide
/// + vraie liste pledges chargée. Sinon "session_expired" (→ reload auto) ou
/// "waiting_login" (la fenêtre reste ouverte).
#[tauri::command]
pub async fn check_rsi_login_status(app: AppHandle) -> Result<Value, String> {
    // Fenêtre absente → l'utilisateur l'a fermée.
    let Some(win) = app.get_webview_window("rsi-login") else {
        return Ok(json!({ "status": "closed" }));
    };

    // Critère 1 — URL.
    let url = win.url().map_err(|e| e.to_string())?;
    let url_str = url.as_str().to_string();
    let is_login_page = url_str.contains("/connect")
        || url_str.contains("/login")
        || url_str.contains("/signin");
    let is_blank = url_str.is_empty() || url_str.contains("about:blank");
    let on_pledges = url_str.contains("/account/pledges") && !is_login_page && !is_blank;

    // Critère 2 — Rsi-Token valide.
    let has_token = {
        let origin = tauri::Url::parse(RSI_ORIGIN).map_err(|e| e.to_string())?;
        match win.cookies_for_url(origin) {
            Ok(cookies) => cookies
                .iter()
                .any(|c| c.name() == "Rsi-Token" && !c.value().is_empty()),
            Err(_) => false,
        }
    };

    // Critère 3 (+ détection session expirée) — via un seul eval DOM.
    let dom = eval_dom_string(win.clone(), LOGIN_STATE_SCRIPT).await;
    let bytes = dom.as_bytes();
    let has_pledges_list = bytes.first() == Some(&b'1');
    let expired = bytes.get(1) == Some(&b'1');
    let has_empty = bytes.get(2) == Some(&b'1');

    // Page prête si la liste est peuplée OU si le hangar est vide (.empy-list) :
    // un compte sans flotte est connecté tout autant (réplique V1 « empty = ready »).
    let logged_in = on_pledges && has_token && (has_pledges_list || has_empty);

    let status = if logged_in {
        "logged_in"
    } else if expired {
        "session_expired"
    } else {
        "waiting_login"
    };

    Ok(match status {
        "logged_in" => json!({ "status": "logged_in", "hasToken": true }),
        "session_expired" => json!({ "status": "session_expired" }),
        _ => json!({ "status": "waiting_login" }),
    })
}

/// Recharge la fenêtre rsi-login vers /account/pledges (réplique reloadIgnoringCache
/// de la V1 sur le message "session expired"). Appelée une seule fois par le JS.
#[tauri::command]
pub async fn reload_rsi_login(app: AppHandle) -> Result<(), String> {
    let win = app
        .get_webview_window("rsi-login")
        .ok_or_else(|| "Fenêtre rsi-login absente".to_string())?;
    let url = tauri::Url::parse("https://robertsspaceindustries.com/en/account/pledges")
        .map_err(|e| e.to_string())?;
    win.navigate(url).map_err(|e| e.to_string())
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
    // 1. Lien dossier citoyen (toujours présent sur /account/pledges).
    var link = document.querySelector('a[data-cy-id="link-citizen-dossier"]')
            || document.querySelector('a[href*="/citizens/"]');
    if (link) {
      var href = link.getAttribute('href') || '';
      var m = href.match(/\/citizens\/([^\/?#]+)/);
      if (m && m[1]) return m[1];
    }
    // 2. Repli : span handleName (présent si le panneau compte est ouvert).
    var el = document.querySelector('[data-cy-id="handleName"]');
    if (el && el.textContent) return el.textContent.trim().replace(/^@/, '');
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
    let concierge_level = meta_get(&app, &format!("rsi.concierge.level.{handle}")).await?;
    let concierge_progress = meta_get(&app, &format!("rsi.concierge.progress.{handle}"))
        .await?
        .and_then(|s| s.parse::<f64>().ok());
    Ok(json!({
        "hasToken": token.is_some(),
        "portraitUrl": portrait,
        "conciergeLevel": concierge_level,
        "conciergeProgress": concierge_progress,
    }))
}

/* ──────────────────────  Isolation session par cookies  ──────────────────── */
// WebView2 ne sépare PAS les sessions par dataDirectory (un seul profil
// EBWebView/Default partagé par toutes les fenêtres). On isole donc nous-mêmes :
// on purge les cookies RSI du compte précédent puis on réinjecte ceux du compte
// demandé (réplique comportementale des partitions persist:rsi-<handle> de la V1).

/// Fenêtre dont le cookie manager donne accès au profil WebView2 RSI : la fenêtre
/// rsi-login si ouverte, sinon la fenêtre principale (même profil → mêmes cookies).
/// Permet de purger même quand rsi-login n'est pas (encore) ouverte.
fn rsi_cookie_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    app.get_webview_window("rsi-login")
        .or_else(|| app.get_webview_window("main"))
}

/// Supprime tous les cookies du domaine RSI du profil WebView2. Best-effort
/// (chaque cookie renvoyé par cookies_for_url porte domaine/path → delete cible juste).
#[tauri::command]
pub async fn purge_rsi_cookies(app: AppHandle) -> Result<(), String> {
    let Some(win) = rsi_cookie_window(&app) else {
        return Ok(());
    };
    let origin = tauri::Url::parse(RSI_ORIGIN).map_err(|e| e.to_string())?;
    let cookies = win.cookies_for_url(origin).map_err(|e| e.to_string())?;
    for c in cookies {
        let _ = win.delete_cookie(c);
    }
    Ok(())
}

/// Réinjecte la session stockée pour `handle` (AppMeta `rsi.cookies.<handle>`, format
/// en-tête « name=value; … » écrit par extract_and_store_rsi_session). Le format ne
/// conserve que name=value → on applique les attributs par défaut du domaine RSI
/// (domaine large, https, httpOnly) suffisants pour que le serveur RSI re-valide la
/// session. Renvoie true si ≥ 1 cookie posé ; false si aucun cookie stocké (→ la
/// fenêtre montrera la page de login RSI vierge pour ce compte).
#[tauri::command]
pub async fn inject_rsi_cookies(handle: String, app: AppHandle) -> Result<bool, String> {
    let Some(win) = rsi_cookie_window(&app) else {
        return Err("Aucune fenêtre webview disponible".into());
    };
    let Some(header) = meta_get(&app, &format!("rsi.cookies.{handle}")).await? else {
        return Ok(false);
    };
    let mut count = 0;
    for pair in header.split(';') {
        let pair = pair.trim();
        let Some((name, value)) = pair.split_once('=') else {
            continue;
        };
        let name = name.trim();
        if name.is_empty() {
            continue;
        }
        let mut cookie = Cookie::new(name.to_string(), value.trim().to_string());
        cookie.set_domain(".robertsspaceindustries.com");
        cookie.set_path("/");
        cookie.set_secure(true);
        cookie.set_http_only(true);
        if win.set_cookie(cookie).is_ok() {
            count += 1;
        }
    }
    Ok(count > 0)
}

/* ────────────────────────────────  logout_rsi  ───────────────────────────── */

#[tauri::command]
pub async fn logout_rsi(handle: String, app: AppHandle) -> Result<(), String> {
    // Purge la session vivante du profil partagé (best-effort) PUIS supprime les
    // clés AppMeta du compte — dont rsi.cookies.<handle>, ce qui force un re-login au
    // prochain connect (réplique de clearStorageData() de la V1).
    let _ = purge_rsi_cookies(app.clone()).await;
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
