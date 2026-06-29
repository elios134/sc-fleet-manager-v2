// Onglet « Hangar Executive » (PYAM) — tracker du cycle ouvert/fermé du hangar
// exécutif de Pyro + minuteurs de terminaux. Réécrit clean-room (la formule de cycle
// est un fait de jeu calibré par la communauté ; on lit la donnée publique exec.xyxyll.com).
//
// Temps exposés en epoch MILLIS (i64) → le front fait `new Date(ms)`. Cache statut 60 s.
// Minuteurs persistés en AppMeta (clé hangar.timers).

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::State;
use tauri_plugin_sql::{DbInstances, DbPool};

use crate::DB_URL;

const EXEC_APP_JS_URL: &str = "https://exec.xyxyll.com/app.js";
const USER_AGENT: &str = "SCFleetManager/2.0 (HangarExec)";
const STATUS_CACHE_TTL_SECS: u64 = 60;
const TERMINAL_TIMER_SECS: i64 = 30 * 60;
const TIMERS_META_KEY: &str = "hangar.timers";

// Cycle PYAM : 65 min ouvert / 120 min fermé, + dérive observée de 226 ms par cycle.
const ONLINE_MS: i64 = 65 * 60 * 1000;
const CYCLE_BASE_MS: i64 = (65 + 120) * 60 * 1000;
const CYCLE_DRIFT_MS: i64 = 226;
// Numéro de cycle de référence à INITIAL_OPEN_TIME (cf. commentaire de la source).
const INITIAL_CYCLE_NUMBER: i64 = 36;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HangarExecStatus {
    pub status: String, // "ONLINE" | "OFFLINE"
    pub next_change_ms: i64,
    pub seconds_remaining: i64,
    pub cycle_number: i64,
    pub initial_open_ms: i64,
    pub version_label: Option<String>,
    pub last_modified: Option<String>,
    pub source_url: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HangarExecScheduleEvent {
    pub event_type: String, // "Online" | "Offline"
    pub at_ms: i64,
    pub cycle_number: i64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HangarExecStatusResponse {
    pub status: HangarExecStatus,
    pub upcoming: Vec<HangarExecScheduleEvent>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HangarTerminalPreset {
    pub id: String,
    pub label: String,
    pub location: String,
    pub timer_seconds: i64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HangarTerminalTimer {
    pub terminal_id: String,
    pub ends_at_ms: i64,
    pub seconds_remaining: i64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HangarExecTimersResponse {
    pub terminals: Vec<HangarTerminalPreset>,
    pub active_timers: Vec<HangarTerminalTimer>,
}

#[derive(Deserialize, Serialize, Default)]
struct TimersStore {
    timers: Vec<StoredTimer>,
}
#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StoredTimer {
    terminal_id: String,
    ends_at_ms: i64,
}

struct CacheEntry {
    fetched_at: SystemTime,
    response: HangarExecStatusResponse,
}
static STATUS_CACHE: Mutex<Option<CacheEntry>> = Mutex::new(None);

/* ───────────────────────── cycle (fonctions pures) ───────────────────────── */

fn cycle_ms() -> i64 {
    CYCLE_BASE_MS + CYCLE_DRIFT_MS
}
fn open_ms() -> i64 {
    ((cycle_ms() as f64) * (ONLINE_MS as f64) / (CYCLE_BASE_MS as f64)).round() as i64
}
fn close_ms() -> i64 {
    cycle_ms() - open_ms()
}

/// Statut courant + instant (ms) du prochain changement.
fn next_status_change(now: i64, initial_open: i64) -> (String, i64) {
    let cycle = cycle_ms();
    let open = open_ms();
    let t = (now - initial_open).rem_euclid(cycle);
    if t < open {
        ("ONLINE".to_string(), now + (open - t))
    } else {
        ("OFFLINE".to_string(), now + (close_ms() - (t - open)))
    }
}

fn event_cycle_number(event_ms: i64, initial_open: i64) -> i64 {
    (event_ms - initial_open).div_euclid(cycle_ms()) + INITIAL_CYCLE_NUMBER
}

fn build_schedule(now: i64, initial_open: i64, limit: usize) -> Vec<HangarExecScheduleEvent> {
    let (status, mut next_ms) = next_status_change(now, initial_open);
    let mut online = status == "ONLINE";
    let end_ms = now + 3 * 24 * 60 * 60 * 1000;
    let mut events = Vec::new();
    while next_ms < end_ms && events.len() < limit {
        events.push(HangarExecScheduleEvent {
            // À `next_ms`, le hangar passe à l'état OPPOSÉ de l'état courant.
            event_type: if online { "Offline" } else { "Online" }.to_string(),
            at_ms: next_ms,
            cycle_number: event_cycle_number(next_ms, initial_open),
        });
        next_ms += if online { close_ms() } else { open_ms() };
        online = !online;
    }
    events
}

/* ───────────────────────── source app.js (réseau) ───────────────────────── */

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn parse_initial_open_ms(app_js: &str) -> Result<i64, String> {
    let re = Regex::new(r"INITIAL_OPEN_TIME\s*=\s*new Date\('([^']+)'\)").map_err(|e| e.to_string())?;
    let raw = re
        .captures(app_js)
        .and_then(|c| c.get(1))
        .ok_or_else(|| "INITIAL_OPEN_TIME introuvable dans app.js".to_string())?
        .as_str();
    chrono::DateTime::parse_from_rfc3339(raw)
        .map(|dt| dt.timestamp_millis())
        .map_err(|e| format!("Date initiale invalide: {e}"))
}

fn parse_first(app_js: &str, pattern: &str) -> Option<String> {
    Regex::new(pattern)
        .ok()
        .and_then(|re| re.captures(app_js).and_then(|c| c.get(1)).map(|m| m.as_str().trim().to_string()))
}

async fn build_status_response() -> Result<HangarExecStatusResponse, String> {
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client.get(EXEC_APP_JS_URL).send().await.map_err(|e| format!("Réseau exec.xyxyll.com: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("exec.xyxyll.com HTTP {}", resp.status()));
    }
    let app_js = resp.text().await.map_err(|e| e.to_string())?;

    let initial_open = parse_initial_open_ms(&app_js)?;
    let now = now_ms();
    let (status, next_change_ms) = next_status_change(now, initial_open);
    Ok(HangarExecStatusResponse {
        status: HangarExecStatus {
            status,
            next_change_ms,
            seconds_remaining: ((next_change_ms - now).max(0)) / 1000,
            cycle_number: event_cycle_number(next_change_ms, initial_open),
            initial_open_ms: initial_open,
            version_label: parse_first(&app_js, r"Star Citizen Patch ([^)]+)"),
            last_modified: parse_first(&app_js, r"@lastModified\s+([0-9]{4}-[A-Za-z]{3}-[0-9]{2})"),
            source_url: EXEC_APP_JS_URL.to_string(),
        },
        upcoming: build_schedule(now, initial_open, 12),
    })
}

/* ───────────────────────── terminaux + minuteurs ───────────────────────── */

fn preset(id: &str, location: &str, label: &str) -> HangarTerminalPreset {
    HangarTerminalPreset {
        id: id.to_string(),
        label: label.to_string(),
        location: location.to_string(),
        timer_seconds: TERMINAL_TIMER_SECS,
    }
}

pub fn terminal_presets() -> Vec<HangarTerminalPreset> {
    vec![
        preset("checkmate-1", "Checkmate", "Tablette 1"),
        preset("checkmate-2", "Checkmate", "Tablette 2"),
        preset("checkmate-3", "Checkmate", "Tablette 3"),
        preset("obituary-4", "Obituary", "Tablette 4"),
        preset("obituary-7", "Obituary", "Tablette 7"),
        preset("ruin-5", "Ruin Station", "Tablette 5"),
        preset("ruin-6", "Ruin Station", "Tablette 6"),
        preset("pyam-red-3-4", "PYAM-SUPVISR", "Carte d'accès Rouge 3-4"),
        preset("pyam-red-3-5", "PYAM-SUPVISR", "Carte d'accès Rouge 3-5"),
    ]
}

async fn load_store(pool: &sqlx::SqlitePool) -> TimersStore {
    crate::commands::app_meta::get(pool, TIMERS_META_KEY)
        .await
        .and_then(|s| serde_json::from_str::<TimersStore>(&s).ok())
        .unwrap_or_default()
}
async fn save_store(pool: &sqlx::SqlitePool, store: &TimersStore) {
    if let Ok(s) = serde_json::to_string(store) {
        let _ = crate::commands::app_meta::set(pool, TIMERS_META_KEY, &s).await;
    }
}
fn active_timers(store: &TimersStore) -> Vec<HangarTerminalTimer> {
    let now = now_ms();
    store
        .timers
        .iter()
        .filter(|t| t.ends_at_ms > now)
        .map(|t| HangarTerminalTimer {
            terminal_id: t.terminal_id.clone(),
            ends_at_ms: t.ends_at_ms,
            seconds_remaining: (t.ends_at_ms - now) / 1000,
        })
        .collect()
}

/* ───────────────────────── commandes Tauri ───────────────────────── */

/// Statut PYAM (cache 60 s, source exec.xyxyll.com).
#[tauri::command]
pub async fn get_hangar_exec_status() -> Result<HangarExecStatusResponse, String> {
    {
        let cache = STATUS_CACHE.lock().unwrap();
        if let Some(e) = cache.as_ref() {
            if e.fetched_at.elapsed().map(|d| d < Duration::from_secs(STATUS_CACHE_TTL_SECS)).unwrap_or(false) {
                return Ok(e.response.clone());
            }
        }
    }
    let response = build_status_response().await?;
    *STATUS_CACHE.lock().unwrap() = Some(CacheEntry {
        fetched_at: SystemTime::now(),
        response: response.clone(),
    });
    Ok(response)
}

/// Terminaux prédéfinis + minuteurs actifs.
#[tauri::command]
pub async fn get_hangar_exec_timers(
    db_instances: State<'_, DbInstances>,
) -> Result<HangarExecTimersResponse, String> {
    let lock = db_instances.0.read().await;
    let pool = match lock.get(DB_URL) {
        Some(DbPool::Sqlite(p)) => p,
        _ => return Err(format!("Base non chargée : {DB_URL}")),
    };
    let mut store = load_store(pool).await;
    let before = store.timers.len();
    let now = now_ms();
    store.timers.retain(|t| t.ends_at_ms > now);
    if store.timers.len() != before {
        save_store(pool, &store).await;
    }
    Ok(HangarExecTimersResponse {
        terminals: terminal_presets(),
        active_timers: active_timers(&store),
    })
}

/// Démarre (ou relance) un minuteur terminal de 30 min, persistant.
#[tauri::command]
pub async fn start_hangar_exec_timer(
    terminal_id: String,
    db_instances: State<'_, DbInstances>,
) -> Result<HangarExecTimersResponse, String> {
    if !terminal_presets().iter().any(|t| t.id == terminal_id) {
        return Err(format!("Terminal inconnu: {terminal_id}"));
    }
    let lock = db_instances.0.read().await;
    let pool = match lock.get(DB_URL) {
        Some(DbPool::Sqlite(p)) => p,
        _ => return Err(format!("Base non chargée : {DB_URL}")),
    };
    let mut store = load_store(pool).await;
    let now = now_ms();
    store.timers.retain(|t| t.ends_at_ms > now && t.terminal_id != terminal_id);
    store.timers.push(StoredTimer {
        terminal_id,
        ends_at_ms: now + TERMINAL_TIMER_SECS * 1000,
    });
    save_store(pool, &store).await;
    Ok(HangarExecTimersResponse {
        terminals: terminal_presets(),
        active_timers: active_timers(&store),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cycle_durations_consistent() {
        assert_eq!(open_ms() + close_ms(), cycle_ms());
        assert_eq!(cycle_ms(), CYCLE_BASE_MS + CYCLE_DRIFT_MS);
    }

    #[test]
    fn status_online_then_offline() {
        let init = 0;
        // t=0 → ouvert, change à open_ms
        let (s, next) = next_status_change(0, init);
        assert_eq!(s, "ONLINE");
        assert_eq!(next, open_ms());
        // juste après l'ouverture expirée → fermé, change à la fin du cycle
        let (s2, next2) = next_status_change(open_ms(), init);
        assert_eq!(s2, "OFFLINE");
        assert_eq!(next2, cycle_ms());
    }

    #[test]
    fn status_handles_past_initial_via_rem_euclid() {
        let init = 1_000_000;
        let (s, _) = next_status_change(init - cycle_ms() * 3, init); // bien avant l'init
        assert!(s == "ONLINE" || s == "OFFLINE"); // pas de panic, rem_euclid gère le négatif
    }

    #[test]
    fn schedule_alternates_and_limits() {
        let ev = build_schedule(0, 0, 5);
        assert_eq!(ev.len(), 5);
        assert_eq!(ev[0].event_type, "Offline"); // ouvert à t=0 → 1er événement = fermeture
        assert_eq!(ev[1].event_type, "Online");
        assert!(ev[1].at_ms > ev[0].at_ms);
    }

    #[test]
    fn cycle_number_uses_offset() {
        assert_eq!(event_cycle_number(0, 0), INITIAL_CYCLE_NUMBER);
        assert_eq!(event_cycle_number(cycle_ms() * 2, 0), INITIAL_CYCLE_NUMBER + 2);
    }
}
