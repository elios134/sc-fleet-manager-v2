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

/* ─────────────────────────── Résolution du binaire ─────────────────────────── */

/// Chemin du binaire StarBreaker. Dev : sources (CARGO_MANIFEST_DIR/resources/…).
/// Packagé : dossier resources Tauri (cf. bundle.resources). Réplique resolveBinaryPath V1.
fn resolve_binary_path(app: &AppHandle) -> PathBuf {
    if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("starbreaker")
            .join("starbreaker.exe")
    } else {
        app.path()
            .resolve("resources/starbreaker/starbreaker.exe", BaseDirectory::Resource)
            .unwrap_or_else(|_| PathBuf::from("starbreaker.exe"))
    }
}

/* ─────────────────────────── Exécution de processus ────────────────────────── */

fn base_command(program: &Path) -> Command {
    let mut c = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(CREATE_NO_WINDOW);
    }
    c
}

/// Lance starbreaker en capturant stdout (dcb query). Stocke le PID (pour kill).
fn run_capture(bin: &Path, args: &[String]) -> Result<String, String> {
    let child = base_command(bin)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    *CURRENT_PID.lock().unwrap() = Some(child.id());
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    *CURRENT_PID.lock().unwrap() = None;
    if !out.status.success() {
        let code = out.status.code().map(|c| c.to_string()).unwrap_or_else(|| "null".into());
        let detail = String::from_utf8_lossy(&out.stderr);
        return Err(format!("code {code}: {}", detail.trim()));
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

/// Lance starbreaker en ignorant stdout (p4k/dcb extract). Stocke le PID.
fn run_extract(bin: &Path, args: &[String]) -> Result<(), String> {
    let child = base_command(bin)
        .args(args)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    *CURRENT_PID.lock().unwrap() = Some(child.id());
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    *CURRENT_PID.lock().unwrap() = None;
    if !out.status.success() {
        let code = out.status.code().map(|c| c.to_string()).unwrap_or_else(|| "null".into());
        let detail = String::from_utf8_lossy(&out.stderr);
        return Err(format!("code {code}: {}", detail.trim()));
    }
    Ok(())
}

/// Tue le processus StarBreaker courant (annulation). Best-effort, via taskkill /T /F.
fn kill_current() {
    let pid = *CURRENT_PID.lock().unwrap();
    if let Some(pid) = pid {
        #[cfg(windows)]
        {
            let _ = base_command(Path::new("taskkill"))
                .args(["/PID", &pid.to_string(), "/T", "/F"])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        }
    }
}

/* ───────────────────────────── Construction d'args ─────────────────────────── */

fn dcb_query_args(class_name: &str, p4k: &str) -> Vec<String> {
    vec![
        "dcb".into(),
        "query".into(),
        "EntityClassDefinition".into(),
        "--filter".into(),
        format!("*{class_name}*"),
        "--p4k".into(),
        p4k.into(),
    ]
}

fn p4k_extract_args(p4k: &str, out: &str, filter: &str) -> Vec<String> {
    vec![
        "p4k".into(),
        "extract".into(),
        "--p4k".into(),
        p4k.into(),
        "-o".into(),
        out.into(),
        "--filter".into(),
        filter.into(),
    ]
}

fn dcb_extract_args(p4k: &str, out: &str, filter: &str) -> Vec<String> {
    vec![
        "dcb".into(),
        "extract".into(),
        "--p4k".into(),
        p4k.into(),
        "--format".into(),
        "json".into(),
        "-o".into(),
        out.into(),
        "--filter".into(),
        filter.into(),
    ]
}

/* ──────────────────────── Parsing stdout dcb query (V1) ────────────────────── */

/// Découpe le stdout (objets JSON top-level concaténés) en enregistrements.
fn parse_starbreaker_records(stdout: &str) -> Vec<Value> {
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }
    if trimmed.starts_with('[') {
        if let Ok(Value::Array(a)) = serde_json::from_str::<Value>(trimmed) {
            return a;
        }
    }
    let mut records = Vec::new();
    let mut depth = 0i32;
    let mut start: Option<usize> = None;
    let mut in_string = false;
    let mut escaped = false;
    let bytes = stdout.as_bytes();
    for (i, &c) in bytes.iter().enumerate() {
        if escaped {
            escaped = false;
            continue;
        }
        if c == b'\\' {
            escaped = true;
            continue;
        }
        if c == b'"' {
            in_string = !in_string;
            continue;
        }
        if in_string {
            continue;
        }
        if c == b'{' {
            if depth == 0 {
                start = Some(i);
            }
            depth += 1;
        } else if c == b'}' {
            depth -= 1;
            if depth == 0 {
                if let Some(s) = start.take() {
                    if let Ok(v) = serde_json::from_str::<Value>(&stdout[s..=i]) {
                        records.push(v);
                    }
                }
            }
        }
    }
    records
}

/// JSON de l'enregistrement dont _RecordName_ == EntityClassDefinition.<class>. None sinon.
fn parse_exact_record(stdout: &str, class_name: &str) -> Option<String> {
    let target = format!("EntityClassDefinition.{class_name}");
    parse_starbreaker_records(stdout)
        .into_iter()
        .find(|r| r.get("_RecordName_").and_then(|v| v.as_str()) == Some(target.as_str()))
        .map(|r| r.to_string())
}

/* ─────────────────────── Phase 1 — noms de classes (SC Wiki) ───────────────── */

fn fetch_class_names() -> Result<Vec<String>, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;

    let mut names = Vec::new();
    let mut page = 1u32;
    loop {
        check_cancel()?;
        let url = format!("{SC_WIKI_VEHICLES}?limit=100&page={page}");

        // Jusqu'à 3 tentatives (backoff simple) — réplique de l'esprit de wikiGet V1.
        let mut body: Option<Value> = None;
        let mut last_err = String::new();
        for attempt in 0..3 {
            check_cancel()?;
            match client.get(&url).send() {
                Ok(resp) if resp.status().is_success() => match resp.json::<Value>() {
                    Ok(v) => {
                        body = Some(v);
                        break;
                    }
                    Err(e) => last_err = e.to_string(),
                },
                Ok(resp) => last_err = format!("SC Wiki {}", resp.status()),
                Err(e) => last_err = e.to_string(),
            }
            std::thread::sleep(Duration::from_millis(500 * (1 << attempt)));
        }
        let body = body.ok_or_else(|| format!("SC Wiki injoignable : {last_err}"))?;

        if let Some(arr) = body.get("data").and_then(|v| v.as_array()) {
            for v in arr {
                if let Some(cn) = v.get("class_name").and_then(|c| c.as_str()) {
                    if !cn.is_empty() {
                        names.push(cn.to_string());
                    }
                }
            }
        }
        let last_page = body
            .get("meta")
            .and_then(|m| m.get("last_page"))
            .and_then(|v| v.as_u64())
            .unwrap_or(1) as u32;
        if page >= last_page {
            break;
        }
        page += 1;
        std::thread::sleep(Duration::from_millis(100));
    }
    Ok(names)
}

/* ──────────────────────── Phase d'extraction non-fatale ────────────────────── */

/// dcb extract d'un sous-arbre vers `out`. Échec d'extract = non-fatal (warn + skip) ;
/// SAUF si l'échec vient d'une annulation → on propage.
fn extract_subtree(
    app: &AppHandle,
    bin: &Path,
    p4k: &str,
    out: &Path,
    filter: &str,
    phase: &str,
    message: &str,
) -> Result<(), String> {
    check_cancel()?;
    update_status(|s| {
        s.phase = Some(phase.into());
        s.current_message = message.into();
    });
    emit_progress(app, true);
    if let Err(e) = run_extract(bin, &dcb_extract_args(p4k, &out.display().to_string(), filter)) {
        check_cancel()?; // annulation → propage
        eprintln!("[datamining] extract non-fatal '{filter}' : {e}");
    }
    Ok(())
}

/* ─────────────────────────────── Séquence V1 ──────────────────────────────── */

fn run_sequence(app: &AppHandle, bin: &Path, p4k: &str, temp: &Path) -> Result<(), String> {
    // ── Phase 1 — noms de classes vaisseaux (SC Wiki) — 0→5 % ──
    update_status(|s| {
        s.phase = Some("fetching_classnames".into());
        s.current_message = "Récupération de la liste des vaisseaux…".into();
        s.percent_overall = 0.0;
    });
    emit_progress(app, true);
    let class_names = fetch_class_names()?;
    update_status(|s| s.percent_overall = 5.0);
    emit_progress(app, true);

    // ── Phase 2 — dcb query par vaisseau → ships/<class>.json — 5→100 % ──
    let ships_dir = temp.join("ships");
    fs::create_dir_all(&ships_dir).map_err(|e| e.to_string())?;
    let total = class_names.len();
    let mut done = 0usize;
    let mut fail = 0usize;
    let phase2_start = Instant::now();
    update_status(|s| {
        s.phase = Some("querying_ships".into());
        s.current_message = format!("0/{total}");
    });
    emit_progress(app, true);

    for class_name in &class_names {
        check_cancel()?;
        match run_capture(bin, &dcb_query_args(class_name, p4k)) {
            Ok(stdout) => {
                if let Some(record) = parse_exact_record(&stdout, class_name) {
                    let _ = fs::write(ships_dir.join(format!("{class_name}.json")), record);
                }
            }
            Err(e) => {
                check_cancel()?; // kill par annulation → propage
                fail += 1;
                eprintln!("[datamining] dcb query échoué '{class_name}' : {e}");
                if total > 0 && (fail as f64 / total as f64) > MAX_FAIL_RATIO {
                    return Err(format!(
                        "Extraction abandonnée : {fail}/{total} requêtes échouées (>{}%)",
                        (MAX_FAIL_RATIO * 100.0) as i64
                    ));
                }
            }
        }
        done += 1;
        if done % 5 == 0 || done == total {
            let elapsed = phase2_start.elapsed().as_secs_f64();
            let rate = if elapsed > 0.0 { done as f64 / elapsed } else { 0.0 };
            let eta = if rate > 0.0 {
                Some(((total.saturating_sub(done)) as f64 / rate).round() as i64)
            } else {
                None
            };
            let pct = if total > 0 {
                5.0 + (done as f64 / total as f64) * 95.0
            } else {
                100.0
            };
            update_status(|s| {
                s.percent_overall = pct;
                s.eta_seconds = eta;
                s.current_message = format!("{done}/{total}");
            });
            emit_progress(app, false);
        }
    }

    // ── Phase 3 — global.ini (p4k extract, EN + FR dans la même passe) ──
    check_cancel()?;
    update_status(|s| {
        s.phase = Some("extracting_localization".into());
        s.current_message = "Extraction de la localisation…".into();
    });
    emit_progress(app, true);
    if let Err(e) = run_extract(bin, &p4k_extract_args(p4k, &temp.display().to_string(), FILTER_GLOBAL_INI)) {
        check_cancel()?;
        eprintln!("[datamining] global.ini non-fatal : {e}");
    }

    // ── Phase 4 — contractgenerator (missions) ──
    extract_subtree(
        app, bin, p4k, &temp.join("contracts_dump"), FILTER_CONTRACTS,
        "extracting_contracts", "Extraction des contrats…",
    )?;

    // ── Phase 5 — blueprints/crafting ──
    extract_subtree(
        app, bin, p4k, &temp.join("blueprints_dump"), FILTER_BLUEPRINTS,
        "extracting_blueprints", "Extraction des blueprints…",
    )?;

    // ── Phase 5b — blueprintrewards ──
    extract_subtree(
        app, bin, p4k, &temp.join("blueprint_rewards_dump"), FILTER_BLUEPRINT_REWARDS,
        "extracting_blueprint_rewards", "Extraction des récompenses de blueprints…",
    )?;

    // ── Phase 6 — mining (4 sous-arbres dans le MÊME mining_dump) ──
    check_cancel()?;
    update_status(|s| {
        s.phase = Some("extracting_mining".into());
        s.current_message = "Extraction des données de minage…".into();
    });
    emit_progress(app, true);
    let mining_dump = temp.join("mining_dump");
    for filter in FILTER_MINING {
        check_cancel()?;
        if let Err(e) = run_extract(bin, &dcb_extract_args(p4k, &mining_dump.display().to_string(), filter)) {
            check_cancel()?;
            eprintln!("[datamining] mining non-fatal '{filter}' : {e}");
        }
    }

    // ── Phase 7 — scitem ──
    extract_subtree(
        app, bin, p4k, &temp.join("scitem_dump"), FILTER_SCITEM,
        "extracting_scitem", "Extraction du corpus scitem…",
    )?;

    Ok(())
}

fn cleanup(temp: &Path) {
    let _ = fs::remove_dir_all(temp);
}

/* ───────────────────────── Apply (enchaîné après extraction) ───────────────── */
// Réutilise les 3 fonctions *_core de datamining.rs (déjà paramétrées par dump_dir),
// en les pointant sur le dossier d'extraction du Lot 1 (au lieu de STABLE_DUMP_DIR).
// Indépendantes en V2 (mining/starmap résolvent les noms depuis mining_dump, pas la DB ;
// enrich_blueprint_stats met à jour les CraftingBlueprint existants). Ordre arbitraire mais
// stable : starmap → mining → stats. Une erreur d'un _core (dump incomplet) remonte.

fn run_apply(app: &AppHandle, temp: &Path) -> Result<(), String> {
    let dump = temp.to_string_lossy().to_string();

    check_cancel()?;
    update_status(|s| {
        s.phase = Some("applying".into());
        s.current_message = "Application : carte galactique…".into();
    });
    emit_progress(app, true);
    tauri::async_runtime::block_on(crate::commands::datamining::sync_starmap_core(app, &dump))?;

    check_cancel()?;
    update_status(|s| s.current_message = "Application : localisations de minage…".into());
    emit_progress(app, true);
    tauri::async_runtime::block_on(crate::commands::datamining::sync_mining_locations_core(app, &dump))?;

    check_cancel()?;
    update_status(|s| s.current_message = "Application : stats de craft…".into());
    emit_progress(app, true);
    tauri::async_runtime::block_on(crate::commands::datamining::enrich_blueprint_stats_core(app, &dump))?;

    Ok(())
}

/* ─────────────────────────── AppMeta + validation chemin ───────────────────── */

/// Lit le chemin d'install configuré (AppMeta `datamining.scInstallPath`). None si vide/absent.
async fn read_configured_install(app: &AppHandle) -> Option<String> {
    let instances = app.state::<DbInstances>();
    let lock = instances.0.read().await;
    let db = lock.get(DB_URL)?;
    let pool = match db {
        DbPool::Sqlite(p) => p,
        #[allow(unreachable_patterns)]
        _ => return None,
    };
    sqlx::query("SELECT value FROM AppMeta WHERE key = ?")
        .bind(SC_INSTALL_KEY)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
        .and_then(|r| r.try_get::<String, _>("value").ok())
        .filter(|s| !s.trim().is_empty())
}

async fn meta_set(app: &AppHandle, key: &str, value: &str) -> Result<(), String> {
    let instances = app.state::<DbInstances>();
    let lock = instances.0.read().await;
    let db = lock.get(DB_URL).ok_or_else(|| format!("Base non chargée : {DB_URL}"))?;
    let pool = match db {
        DbPool::Sqlite(p) => p,
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

async fn meta_delete(app: &AppHandle, key: &str) -> Result<(), String> {
    let instances = app.state::<DbInstances>();
    let lock = instances.0.read().await;
    let db = lock.get(DB_URL).ok_or_else(|| format!("Base non chargée : {DB_URL}"))?;
    let pool = match db {
        DbPool::Sqlite(p) => p,
        #[allow(unreachable_patterns)]
        _ => return Err("Connexion SQLite attendue".into()),
    };
    sqlx::query("DELETE FROM AppMeta WHERE key = ?")
        .bind(key)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Validation d'un dossier d'install (réplique V1 validatePath) : Data.p4k + Game.log
/// (ou au moins un logbackups/*.log).
fn validate_path_fs(path: &str) -> (bool, bool) {
    let p = Path::new(path);
    let has_p4k = p.join("Data.p4k").is_file();
    let has_game_log = p.join("Game.log").is_file() || logbackups_has_log(p);
    (has_p4k, has_game_log)
}

fn logbackups_has_log(install: &Path) -> bool {
    fs::read_dir(install.join("logbackups"))
        .map(|rd| {
            rd.flatten().any(|e| {
                e.path()
                    .extension()
                    .and_then(|x| x.to_str())
                    .map(|x| x.eq_ignore_ascii_case("log"))
                    .unwrap_or(false)
            })
        })
        .unwrap_or(false)
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
