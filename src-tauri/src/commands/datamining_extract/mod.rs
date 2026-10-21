// Runner d'extraction StarBreaker — port Rust fidèle de V1 starbreakerRunner.ts.
// Lance starbreaker.exe avec les commandes EXACTES de la V1 (dcb query / p4k extract /
// dcb extract --format json) vers un dossier temp, dans l'ordre des Phases 1→7.
// PAS d'apply ici (Lot 2) : ce lot produit seulement les dumps + émet la progression.
//
// Commandes reprises telles quelles de V1 :
//   dcb query EntityClassDefinition --filter *<class>* --p4k <p4k>
//   p4k extract --p4k <p4k> -o <out> --filter **/global.ini
//   dcb extract --p4k <p4k> --format json -o <out> --filter <chemin interne complet>
// p4k passé via le FLAG --p4k (jamais SC_DATA_P4K).

use serde::Serialize;
use serde_json::{json, Value};
use sqlx::Row;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_sql::{DbInstances, DbPool};

use crate::DB_URL;
/// Clé AppMeta du chemin d'install configuré manuellement (lue aussi par patch_detect).
const SC_INSTALL_KEY: &str = "datamining.scInstallPath";

/* ───────────────────────────── Filtres internes V1 ────────────────────────── */
// Chemins internes COMPLETS (jamais `**/*pattern*` — qui renvoie toujours 0 sur dcb).

const FILTER_GLOBAL_INI: &str = "**/global.ini";
const FILTER_CONTRACTS: &str = "libs/foundry/records/contracts/contractgenerator/**";
const FILTER_BLUEPRINTS: &str = "libs/foundry/records/crafting/blueprints/crafting/**";
const FILTER_BLUEPRINT_REWARDS: &str = "libs/foundry/records/crafting/blueprintrewards/**";
const FILTER_MINING: [&str; 4] = [
    "libs/foundry/records/harvestable/**",
    "libs/foundry/records/entities/mineable/**",
    "libs/foundry/records/mining/**",
    "libs/foundry/records/starmap/pu/system/**",
];
const FILTER_SCITEM: &str = "libs/foundry/records/entities/scitem/**";

const SC_WIKI_VEHICLES: &str = "https://api.star-citizen.wiki/api/v2/vehicles";
const MAX_FAIL_RATIO: f64 = 0.1;
const EMIT_THROTTLE_MS: u64 = 1000;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/* ──────────────────────────────── État partagé ────────────────────────────── */

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractionStatus {
    pub state: String, // idle | running | cancelling | completed | error
    pub phase: Option<String>,
    pub percent_overall: f64,
    pub started_at: Option<i64>, // epoch ms
    pub eta_seconds: Option<i64>,
    pub current_message: String,
    pub error_message: Option<String>,
    pub temp_dir: Option<String>,
}

fn idle_status() -> ExtractionStatus {
    ExtractionStatus {
        state: "idle".into(),
        phase: None,
        percent_overall: 0.0,
        started_at: None,
        eta_seconds: None,
        current_message: String::new(),
        error_message: None,
        temp_dir: None,
    }
}

static STATE: Mutex<Option<ExtractionStatus>> = Mutex::new(None);
static RUNNING: AtomicBool = AtomicBool::new(false);
static CANCEL: AtomicBool = AtomicBool::new(false);
static CURRENT_PID: Mutex<Option<u32>> = Mutex::new(None);
static LAST_EMIT_MS: Mutex<u64> = Mutex::new(0);

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn read_status() -> ExtractionStatus {
    STATE.lock().unwrap().clone().unwrap_or_else(idle_status)
}

fn update_status<F: FnOnce(&mut ExtractionStatus)>(f: F) {
    let mut g = STATE.lock().unwrap();
    let mut s = g.take().unwrap_or_else(idle_status);
    f(&mut s);
    *g = Some(s);
}

/// Émet datamining:extraction-progress (throttlé ~1 s ; `force` ignore le throttle).
fn emit_progress(app: &AppHandle, force: bool) {
    if !force {
        let mut last = LAST_EMIT_MS.lock().unwrap();
        let now = now_ms();
        if now.saturating_sub(*last) < EMIT_THROTTLE_MS {
            return;
        }
        *last = now;
    } else {
        *LAST_EMIT_MS.lock().unwrap() = now_ms();
    }
    let _ = app.emit("datamining:extraction-progress", read_status());
}

fn check_cancel() -> Result<(), String> {
    if CANCEL.load(Ordering::SeqCst) {
        Err("__cancelled__".into())
    } else {
        Ok(())
    }
}

/* ──────────────────────────────── Commandes ───────────────────────────────── */

/// Lance la séquence d'extraction StarBreaker en arrière-plan (thread dédié).
/// Idempotent : erreur si déjà en cours. Émet la progression via events Tauri.
#[tauri::command]
pub async fn start_extraction(app: AppHandle) -> Result<(), String> {
    if RUNNING.swap(true, Ordering::SeqCst) {
        return Err("Une extraction est déjà en cours.".into());
    }
    CANCEL.store(false, Ordering::SeqCst);

    // Binaire.
    let bin = resolve_binary_path(&app);
    if !bin.is_file() {
        RUNNING.store(false, Ordering::SeqCst);
        let msg = format!("binaire StarBreaker introuvable : {}", bin.display());
        update_status(|s| {
            *s = idle_status();
            s.state = "error".into();
            s.error_message = Some(msg.clone());
        });
        let _ = app.emit("datamining:extraction-error", json!({ "error": msg, "retryable": false }));
        return Err(msg);
    }

    // Install SC → Data.p4k : chemin configuré (AppMeta) prioritaire, sinon auto-détection.
    let configured = read_configured_install(&app).await;
    let Some((install_path, _channel)) = crate::commands::patch_detect::resolve_sc_install(configured) else {
        RUNNING.store(false, Ordering::SeqCst);
        let msg = "Installation Star Citizen introuvable (Data.p4k absent).".to_string();
        update_status(|s| {
            *s = idle_status();
            s.state = "error".into();
            s.error_message = Some(msg.clone());
        });
        let _ = app.emit("datamining:extraction-error", json!({ "error": msg, "retryable": true }));
        return Err(msg);
    };
    let p4k = Path::new(&install_path).join("Data.p4k");
    if !p4k.is_file() {
        RUNNING.store(false, Ordering::SeqCst);
        let msg = format!("Data.p4k introuvable : {}", p4k.display());
        update_status(|s| {
            *s = idle_status();
            s.state = "error".into();
            s.error_message = Some(msg.clone());
        });
        let _ = app.emit("datamining:extraction-error", json!({ "error": msg, "retryable": true }));
        return Err(msg);
    }

    // Dossier temp.
    let temp = std::env::temp_dir().join(format!("scfleet-datamining-{}", now_ms()));
    if let Err(e) = fs::create_dir_all(&temp) {
        RUNNING.store(false, Ordering::SeqCst);
        let msg = format!("Création du dossier temp impossible : {e}");
        update_status(|s| {
            *s = idle_status();
            s.state = "error".into();
            s.error_message = Some(msg.clone());
        });
        let _ = app.emit("datamining:extraction-error", json!({ "error": msg, "retryable": true }));
        return Err(msg);
    }

    // État running initial.
    update_status(|s| {
        *s = idle_status();
        s.state = "running".into();
        s.started_at = Some(now_ms() as i64);
        s.current_message = "Initialisation…".into();
        s.temp_dir = Some(temp.display().to_string());
    });
    emit_progress(&app, true);

    let app_bg = app.clone();
    let p4k_s = p4k.display().to_string();
    std::thread::spawn(move || {
        // Extraction (Phases 1→7) PUIS apply (carte/minage/stats) sur le dossier extrait.
        let res = run_sequence(&app_bg, &bin, &p4k_s, &temp).and_then(|()| run_apply(&app_bg, &temp));
        match res {
            Ok(()) => {
                // Mémorise le dossier de dumps réellement produit → les commandes d'apply
                // autonomes (enrich/backfill FR) le réutilisent au lieu d'un chemin codé en dur.
                let _ = tauri::async_runtime::block_on(meta_set(
                    &app_bg,
                    "datamining.dumpDir",
                    &temp.display().to_string(),
                ));
                // Nettoie les dumps d'extractions précédentes (garde seulement la nouvelle).
                purge_old_dumps(&temp);
                update_status(|s| {
                    s.state = "completed".into();
                    s.phase = None;
                    s.percent_overall = 0.0;
                    s.eta_seconds = Some(0);
                    s.current_message = "Extraction terminée".into();
                });
                emit_progress(&app_bg, true);
                let _ = app_bg.emit(
                    "datamining:extraction-completed",
                    json!({ "tempDir": temp.display().to_string() }),
                );
            }
            Err(_) if CANCEL.load(Ordering::SeqCst) => {
                cleanup(&temp);
                update_status(|s| *s = idle_status());
                emit_progress(&app_bg, true);
                let _ = app_bg.emit("datamining:extraction-cancelled", json!({}));
            }
            Err(e) => {
                cleanup(&temp);
                update_status(|s| {
                    *s = idle_status();
                    s.state = "error".into();
                    s.error_message = Some(e.clone());
                });
                emit_progress(&app_bg, true);
                let _ = app_bg.emit("datamining:extraction-error", json!({ "error": e, "retryable": true }));
            }
        }
        *CURRENT_PID.lock().unwrap() = None;
        RUNNING.store(false, Ordering::SeqCst);
    });

    Ok(())
}

/// Annule l'extraction en cours : tue le processus courant + nettoyage (par le thread).
#[tauri::command]
pub fn cancel_extraction(app: AppHandle) -> Result<(), String> {
    if !RUNNING.load(Ordering::SeqCst) {
        return Ok(());
    }
    CANCEL.store(true, Ordering::SeqCst);
    update_status(|s| {
        s.state = "cancelling".into();
        s.current_message = "Annulation…".into();
    });
    emit_progress(&app, true);
    kill_current();
    Ok(())
}

/// Snapshot de l'état d'extraction courant.
#[tauri::command]
pub fn get_extraction_status() -> Result<ExtractionStatus, String> {
    Ok(read_status())
}

/* ───────────────── Override manuel du chemin d'install (backend) ────────────── */

/// Valide un dossier d'install SC (réplique V1 validatePath) : { hasDataP4k, hasGameLog }.
#[tauri::command]
pub async fn validate_sc_path(path: String) -> Result<Value, String> {
    let (p4k, log) = validate_path_fs(&path);
    Ok(json!({ "hasDataP4k": p4k, "hasGameLog": log }))
}

/// Définit (ou efface) le chemin d'install manuel, persisté en AppMeta. Chaîne vide →
/// efface (retour à l'auto-détection). Refus si Data.p4k absent (pas de chemin invalide
/// persisté). Le runner/patch_detect le prennent en compte en priorité.
#[tauri::command]
pub async fn set_sc_install_path(app: AppHandle, path: String) -> Result<(), String> {
    let trimmed = path.trim().to_string();
    if trimmed.is_empty() {
        return meta_delete(&app, SC_INSTALL_KEY).await;
    }
    let (has_p4k, _has_log) = validate_path_fs(&trimmed);
    if !has_p4k {
        return Err(format!("Data.p4k introuvable dans : {trimmed}"));
    }
    meta_set(&app, SC_INSTALL_KEY, &trimmed).await
}

/// Renvoie le chemin configuré + le chemin/canal effectivement résolus (configuré
/// prioritaire, sinon auto-détection) : { configured, resolved, channel }.
#[tauri::command]
pub async fn get_sc_install_path(app: AppHandle) -> Result<Value, String> {
    let configured = read_configured_install(&app).await;
    let resolved = crate::commands::patch_detect::resolve_sc_install(configured.clone());
    Ok(json!({
        "configured": configured,
        "resolved": resolved.as_ref().map(|(p, _)| p.clone()),
        "channel": resolved.as_ref().map(|(_, c)| c.clone()),
    }))
}

// Sous-modules (déclarés après les macros locales, visibles par portée textuelle).
mod process;
pub(crate) use process::*;
mod pipeline;
pub(crate) use pipeline::*;