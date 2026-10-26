use regex::Regex;
use scraper::{ElementRef, Html, Selector};
use serde::Serialize;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::mpsc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};
use tauri_plugin_sql::{DbInstances, DbPool};

const PLEDGES_BASE: &str = "https://robertsspaceindustries.com/en/account/pledges";
const MAX_PAGES: u32 = 50;
const RSI_BASE_URL: &str = "https://robertsspaceindustries.com";
use crate::DB_URL;
const CONCIERGE_URL: &str = "https://robertsspaceindustries.com/en/account/concierge";

/* ──────────────────────────────  Structs  ────────────────────────────────── */

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScrapedPledge {
    rsi_pledge_id: String,
    name: String,
    pledge_type: String,
    current_value_usd: Option<f64>,
    currency: Option<String>,
    is_upgraded: bool,
    is_buybackable: bool,
    created_date: Option<String>,
    pledge_image_url: Option<String>,
    lti: bool,
    insurance_months: Option<i64>,
    ships: Vec<ScrapedShip>,
    items: Vec<ScrapedItem>,
    upgrades: Vec<ScrapedUpgrade>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScrapedShip {
    ship_name: String,
    manufacturer: String,
    manufacturer_code: Option<String>,
    image_url: Option<String>,
    membership_id: Option<String>,
    custom_name: Option<String>,
    is_nameable: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScrapedItem {
    title: String,
    kind: Option<String>,
    image_url: Option<String>,
    manufacturer: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScrapedUpgrade {
    applied_at: Option<String>,
    ccu_id: Option<String>,
    from_ship_name: String,
    to_ship_name: String,
    new_pledge_value: Option<f64>,
}

/* ─────────────────────────────  Navigation  ──────────────────────────────── */

// Script de poll : retourne l'outerHTML dès que la liste (ou l'état vide) apparaît,
// sinon "PENDING" ; "ERROR:<msg>" si exception (avalée sur Windows sinon).
const POLL_SCRIPT: &str = r#"(function(){
  try {
    var list = document.querySelector('.content-wrapper.content-block1.pledges ul.list-items');
    var empty = document.querySelector('.empy-list');
    if (list || empty) return document.documentElement.outerHTML;
    return 'PENDING';
  } catch(e){ return 'ERROR:' + e.message; }
})()"#;

/// Évalue un JS dans la webview et déballe le résultat (eval_with_callback renvoie
/// la valeur sérialisée en JSON). Exécuté dans un thread bloquant : sur Windows
/// WebView2, eval_with_callback interbloque s'il tourne sur le thread principal.
async fn eval_js(win: tauri::WebviewWindow, js: &'static str) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (tx, rx) = mpsc::channel::<String>();
        win.eval_with_callback(js, move |v| {
            let _ = tx.send(v);
        })
        .map_err(|e| e.to_string())?;
        let raw = rx
            .recv_timeout(Duration::from_secs(5))
            .map_err(|_| "eval timeout".to_string())?;
        Ok(serde_json::from_str::<String>(&raw).unwrap_or(raw))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Navigue la fenêtre rsi-login vers la page de pledges donnée, puis poll
/// l'apparition de la liste hydratée et renvoie l'outerHTML.
///
/// Contournement Cloudflare (repris de la logique V1 — évite le refresh manuel) :
/// on attend patiemment (jusqu'à 120 s) que la liste s'hydrate, et si la page reste
/// bloquée (challenge « Just a moment » / Access Denied), on **recharge** la page
/// toutes les ~20 s ; dès que le conteneur pledges apparaît, on extrait et on continue.
/// NB : cette phase de scrape se déroule APRÈS le login → la fenêtre est volontairement
/// hors écran (cf. set_position ci-dessous), donc un éventuel challenge n'est pas
/// résoluble ici ; le challenge de login, lui, est traité pendant la phase visible.
async fn navigate_rsi_page(app: &AppHandle, page: u32) -> Result<String, String> {
    let win = app
        .get_webview_window("rsi-login")
        .ok_or_else(|| "Fenêtre RSI fermée".to_string())?;

    let url_str = format!("{PLEDGES_BASE}?page={page}");
    let url = tauri::Url::parse(&url_str).map_err(|e| e.to_string())?;
    win.navigate(url.clone()).map_err(|e| e.to_string())?;
    // Hors écran après navigate (qui ré-affiche/rescue la fenêtre sur WebView2) →
    // invisible pendant le scrape. Réappliqué après chaque re-navigate ci-dessous.
    let _ = win.set_position(tauri::PhysicalPosition::new(-32000i32, -32000i32));

    let start = Instant::now();
    let mut last_reload = Instant::now();
    let mut last_error = String::new();
    while start.elapsed() < Duration::from_secs(120) {
        tokio::time::sleep(Duration::from_millis(500)).await;
        let res = eval_js(win.clone(), POLL_SCRIPT).await?;
        if res == "PENDING" {
            // Bloqué (chargement long / Cloudflare) → reload périodique « auto-refresh ».
            if last_reload.elapsed() >= Duration::from_secs(20) {
                let _ = win.navigate(url.clone());
                let _ = win.set_position(tauri::PhysicalPosition::new(-32000i32, -32000i32));
                last_reload = Instant::now();
            }
            continue;
        }
        if res.starts_with("ERROR") {
            last_error = res;
            if last_reload.elapsed() >= Duration::from_secs(20) {
                let _ = win.navigate(url.clone());
                let _ = win.set_position(tauri::PhysicalPosition::new(-32000i32, -32000i32));
                last_reload = Instant::now();
            }
            continue;
        }
        return Ok(res);
    }

    if last_error.is_empty() {
        Err(format!(
            "Timeout 120s — page {page} non chargée (challenge Cloudflare non résolu ?)"
        ))
    } else {
        Err(format!("Erreur JS page {page} : {last_error}"))
    }
}

/* ──────────────────────────────  Commande exposée  ────────────────────────── */

/// Scrape le hangar RSI. Retourne `{ pledges: [...], handle: "<handle>"|null }` :
/// le handle est extrait du HTML de la 1ʳᵉ page (fiable, c'est le contenu chargé).
///
/// `expected_handle` (Fix B — garde anti-contamination) : si fourni (flux resync), le
/// handle réellement chargé dans la fenêtre DOIT correspondre (insensible à la casse) ;
/// sinon on **avorte sans rien renvoyer** (le front n'appelle donc jamais
/// sync_fleet_from_scrape → aucune écriture en base). Le premier login (StartPage) ne
/// passe pas ce paramètre → garde inactive (le handle y vient de la saisie utilisateur).
#[tauri::command]
pub async fn scrape_rsi_hangar(
    expected_handle: Option<String>,
    app: AppHandle,
) -> Result<Value, String> {
    let mut seen: HashSet<String> = HashSet::new();
    let mut all: Vec<ScrapedPledge> = Vec::new();
    let mut handle: Option<String> = None;

    for page in 1..=MAX_PAGES {
        let html = navigate_rsi_page(&app, page).await?;

        // Handle extrait du HTML réellement chargé (sur la 1ʳᵉ page disponible).
        if handle.is_none() {
            handle = extract_handle_from_html(&html);
        }

        // Fin : hangar vide / dernière page.
        if html.contains("empy-list") {
            break;
        }

        let pledges = parse_pledge_html(&html);
        if pledges.is_empty() {
            break;
        }

        // Dédup : si toutes les cartes sont déjà vues, RSI a re-servi une page → stop.
        let fresh: Vec<ScrapedPledge> = pledges
            .into_iter()
            .filter(|p| !seen.contains(&p.rsi_pledge_id))
            .collect();
        if fresh.is_empty() {
            break;
        }
        for p in fresh {
            seen.insert(p.rsi_pledge_id.clone());
            all.push(p);
        }
    }

    // Garde anti-contamination (Fix B) : ne renvoie les pledges QUE si la session chargée
    // appartient bien au compte demandé. Avorte avant toute écriture côté front.
    if let Some(expected) = expected_handle.as_deref() {
        match handle.as_deref() {
            // Match (insensible à la casse : les handles RSI peuvent varier en casse) → OK.
            Some(found) if found.to_lowercase() == expected.to_lowercase() => {}
            // Mismatch → erreur claire, aucun import.
            Some(found) => {
                return Err(format!(
                    "Session RSI du mauvais compte : attendu « {expected} », trouvé « {found} ». Import annulé."
                ));
            }
            // Handle non extractible : on ne bloque PAS (un compte vide légitime garde son
            // handle dans la nav, mais en cas d'échec de lecture on évite de bloquer à tort).
            None => {}
        }
    }

    let pledges_json: Vec<Value> = all
        .iter()
        .map(|p| serde_json::to_value(p).map_err(|e| e.to_string()))
        .collect::<Result<_, _>>()?;

    Ok(serde_json::json!({ "pledges": pledges_json, "handle": handle }))
}

/* ──────────────────────────────  Concierge  ──────────────────────────────── */

/// Script SSR (réplique V1 conciergeExtract.ts) : lit le niveau via `#js-status-level`
/// et la progression via `#progress-gauge[data-spend-until-next-rank]` (l'attribut SSR
/// est stable, contrairement à `#gauge-counter` qui est animé de 0 → valeur). Renvoie
/// un JSON `{level, progress}` (progress = string brute, parsée côté Rust).
const CONCIERGE_SCRIPT: &str = r#"(function(){
  try {
    var levelEl = document.getElementById('js-status-level');
    var level = (levelEl && levelEl.textContent) ? levelEl.textContent.trim() : '';
    var progress = '';
    var gauge = document.getElementById('progress-gauge');
    if (gauge) {
      var attr = gauge.getAttribute('data-spend-until-next-rank');
      if (attr) progress = String(attr).trim();
    }
    if (!progress) {
      var counter = document.getElementById('gauge-counter');
      if (counter && counter.textContent) progress = counter.textContent.trim();
    }
    return JSON.stringify({ level: level, progress: progress });
  } catch(e){ return JSON.stringify({ level: '', progress: '' }); }
})()"#;

/// Écrit une valeur AppMeta (INSERT OR REPLACE).
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

/// Écrit un horodatage ISO courant (datetime('now')) sous une clé AppMeta.
async fn meta_set_now(app: &AppHandle, key: &str) -> Result<(), String> {
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
    sqlx::query("INSERT OR REPLACE INTO AppMeta (key, value) VALUES (?, datetime('now'))")
        .bind(key)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Scrape le niveau concierge RSI depuis la fenêtre `rsi-login` (déjà connectée) et le
/// stocke en AppMeta (clés `rsi.concierge.{level,progress,syncedAt}.{handle}`).
///
/// Best-effort : toute erreur (fenêtre absente, navigation/eval KO) est avalée et
/// renvoyée sans faire échouer le flux de login/scrape appelant. Si le niveau n'est pas
/// lisible (null/vide), on ne touche pas aux valeurs existantes (on garde l'ancien).
#[tauri::command]
pub async fn scrape_rsi_concierge(handle: String, app: AppHandle) -> Result<Value, String> {
    let Some(win) = app.get_webview_window("rsi-login") else {
        return Ok(serde_json::json!({ "level": null, "progress": null }));
    };

    // Navigation vers la page concierge (SSR). Scrape post-login → fenêtre hors écran
    // après navigate (qui ré-afficherait la fenêtre sur WebView2).
    if let Ok(url) = tauri::Url::parse(CONCIERGE_URL) {
        let _ = win.navigate(url);
        let _ = win.set_position(tauri::PhysicalPosition::new(-32000i32, -32000i32));
    }

    // Page SSR : settle ~1,5 s ; on réessaie jusqu'à ~15 s si le niveau n'est pas lisible.
    let start = Instant::now();
    let mut level: Option<String> = None;
    let mut progress: Option<f64> = None;
    while start.elapsed() < Duration::from_secs(15) {
        tokio::time::sleep(Duration::from_millis(1500)).await;
        let raw = match eval_js(win.clone(), CONCIERGE_SCRIPT).await {
            Ok(r) => r,
            Err(_) => continue, // eval KO : on retente (best-effort).
        };
        let Ok(v) = serde_json::from_str::<Value>(&raw) else {
            continue;
        };
        let lvl = v.get("level").and_then(|x| x.as_str()).unwrap_or("").trim();
        if lvl.is_empty() {
            continue;
        }
        level = Some(lvl.to_string());
        progress = v
            .get("progress")
            .and_then(|x| x.as_str())
            .and_then(|s| {
                let cleaned: String = s
                    .chars()
                    .filter(|c| c.is_ascii_digit() || *c == '.' || *c == '-')
                    .collect();
                cleaned.parse::<f64>().ok()
            });
        break;
    }

    // Niveau illisible → on ne touche pas aux valeurs existantes.
    let Some(level) = level else {
        return Ok(serde_json::json!({ "level": null, "progress": null }));
    };

    // Stockage AppMeta (best-effort : on n'échoue pas le flux si l'écriture casse).
    let _ = meta_set(&app, &format!("rsi.concierge.level.{handle}"), &level).await;
    if let Some(p) = progress {
        let _ = meta_set(&app, &format!("rsi.concierge.progress.{handle}"), &p.to_string()).await;
    }
    // syncedAt = horodatage SQLite (ISO).
    let _ = meta_set_now(&app, &format!("rsi.concierge.syncedAt.{handle}")).await;

    Ok(serde_json::json!({ "level": level, "progress": progress }))
}

pub(crate) mod parse;
use parse::*;
