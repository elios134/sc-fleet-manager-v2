// Phase 1.1 — Lecteur Game.log (fondation).
//
// Tâche de fond qui « tail » le Game.log de l'installation Star Citizen, parse chaque
// nouvelle ligne en événement typé, le persiste (GameLogEvent) et l'émet au front
// (event Tauri `gamelog:event`). Le lieu courant est mémorisé (AppMeta
// `gamelog.currentLocation`) et diffusé (`gamelog:location`) — il nourrit le GPS de
// trading (Phase 1.2). Achats/ventes alimentent le journal (Phase 1.3).
//
// OPT-IN : désactivé par défaut (AppMeta `gamelog.enabled`). 100 % LOCAL, lecture seule.
//
// Robustesse format : les motifs de lignes SC évoluent à chaque patch. Tout le parsing
// est CENTRALISÉ dans le module `parse` ci-dessous et couvert par des tests unitaires sur
// des lignes-échantillons — un changement de format ne touche qu'un endroit.

use serde::Serialize;
use serde_json::json;
use sqlx::{Row, SqlitePool};
use std::io::{Read, Seek, SeekFrom};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_sql::{DbInstances, DbPool};

use crate::DB_URL;

const POLL_INTERVAL_SECS: u64 = 2;
const BOOT_DELAY_SECS: u64 = 9; // après le monitor notifications, laisse la DB se charger
const MAX_CHUNK_BYTES: u64 = 4 * 1024 * 1024; // garde-fou anti-explosion mémoire

/* ════════════════════════════════ Parsing ════════════════════════════════ */
// Module isolé et testable : aucune I/O, aucune dépendance Tauri.

pub mod parse;

/* ════════════════════════════ Accès base (helpers) ════════════════════════ */

pub(crate) async fn meta_get(pool: &SqlitePool, key: &str) -> Option<String> {
    sqlx::query("SELECT value FROM AppMeta WHERE key = ?")
        .bind(key)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
        .and_then(|r| r.try_get::<String, _>("value").ok())
}

pub(crate) async fn meta_set(pool: &SqlitePool, key: &str, value: &str) {
    let _ = sqlx::query(
        "INSERT INTO AppMeta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(key)
    .bind(value)
    .execute(pool)
    .await;
}

async fn active_account_id(pool: &SqlitePool) -> Option<String> {
    meta_get(pool, "rsiAccount.activeId").await
}

/* ═════════════════════════════ Résolution chemin ══════════════════════════ */

/// Chemin du Game.log à partir de l'install SC résolue (configuré prioritaire).
pub(crate) async fn resolve_gamelog_path(pool: &SqlitePool) -> Option<std::path::PathBuf> {
    let configured = meta_get(pool, "datamining.scInstallPath").await;
    let (install, _channel) = super::patch_detect::resolve_sc_install(configured)?;
    let p = std::path::Path::new(&install).join("Game.log");
    Some(p)
}

/* ═════════════════════════════ Dispatch d'un événement ════════════════════ */

async fn persist_and_emit(
    app: &AppHandle,
    pool: &SqlitePool,
    account_id: &Option<String>,
    ev: &parse::ParsedEvent,
    emit: bool,
) {
    let detail_str = ev.detail.to_string();
    let _ = sqlx::query(
        "INSERT INTO GameLogEvent (accountId, kind, summary, detail, occurredAt)
         VALUES (?, ?, ?, ?, ?)",
    )
    .bind(account_id)
    .bind(ev.kind)
    .bind(&ev.summary)
    .bind(&detail_str)
    .bind(&ev.occurred_at)
    .execute(pool)
    .await;

    // Lieu courant : mémorisé + diffusé (nourrit le GPS de trading).
    if ev.kind == "location" {
        if let Some(zone) = ev.detail.get("zone").and_then(|v| v.as_str()) {
            meta_set(pool, "gamelog.currentLocation", zone).await;
            if emit {
                let _ = app.emit("gamelog:location", json!({ "location": zone }));
            }
        }
    }

    // Personnage actif : mémorisé pour classer morts/kills (PVE/PVP) dans les stats.
    if ev.kind == "session" {
        if let Some(c) = ev.detail.get("character").and_then(|v| v.as_str()) {
            meta_set(pool, "gamelog.character", c).await;
        }
    }

    // Transaction marchande : alimente le journal de commerce (Phase 1.3) au lieu courant.
    if ev.kind == "commodity_buy" || ev.kind == "commodity_sell" {
        let action = ev.detail.get("action").and_then(|v| v.as_str()).unwrap_or("buy");
        let commodity = ev.detail.get("commodity").and_then(|v| v.as_str()).unwrap_or("");
        let scu = ev.detail.get("scu").and_then(|v| v.as_f64());
        let unit = ev.detail.get("unitPrice").and_then(|v| v.as_f64());
        let total = ev.detail.get("totalPrice").and_then(|v| v.as_f64());
        let location = meta_get(pool, "gamelog.currentLocation").await;
        let _ = sqlx::query(
            "INSERT INTO TradeJournal (accountId, action, commodity, scu, unitPrice, totalPrice, location, source, occurredAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'gamelog', ?)",
        )
        .bind(account_id)
        .bind(action)
        .bind(commodity)
        .bind(scu)
        .bind(unit)
        .bind(total)
        .bind(&location)
        .bind(&ev.occurred_at)
        .execute(pool)
        .await;
        if emit {
            let _ = app.emit("trade:journal", ev.detail.clone());
        }
    }

    if emit {
        let _ = app.emit(
            "gamelog:event",
            json!({ "kind": ev.kind, "summary": ev.summary, "detail": ev.detail, "occurredAt": ev.occurred_at }),
        );
    }
}

/* ═════════════════════════════ Boucle de tail ═════════════════════════════ */

/// Lit l'incrément du fichier depuis `offset`, renvoie (nouveau_contenu, nouvel_offset).
/// Gère la rotation (fichier tronqué/recréé → relecture depuis 0).
fn read_increment(path: &std::path::Path, offset: u64) -> std::io::Result<(String, u64)> {
    let mut file = std::fs::File::open(path)?;
    let len = file.metadata()?.len();
    let start = if len < offset { 0 } else { offset }; // rotation détectée
    let to_read = len.saturating_sub(start).min(MAX_CHUNK_BYTES);
    if to_read == 0 {
        return Ok((String::new(), len));
    }
    file.seek(SeekFrom::Start(start))?;
    let mut buf = vec![0u8; to_read as usize];
    file.read_exact(&mut buf)?;
    // Lecture lossy : les logs SC sont ASCII/UTF-8 mais on ne panique jamais.
    Ok((String::from_utf8_lossy(&buf).into_owned(), start + to_read))
}

/// Un passage de tail : lit l'incrément, parse, persiste + émet. Best-effort.
async fn tail_once(app: &AppHandle, pool: &SqlitePool) {
    let Some(path) = resolve_gamelog_path(pool).await else {
        return;
    };
    if !path.is_file() {
        return;
    }
    let path_str = path.to_string_lossy().to_string();

    // Offset courant + détection de changement de fichier (nouvelle install/canal).
    let stored_path = meta_get(pool, "gamelog.path").await.unwrap_or_default();
    let mut offset: u64 = meta_get(pool, "gamelog.offset")
        .await
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    if stored_path != path_str {
        offset = 0;
        meta_set(pool, "gamelog.path", &path_str).await;
    }

    let (chunk, new_offset) = match read_increment(&path, offset) {
        Ok(v) => v,
        Err(_) => return,
    };
    if new_offset != offset {
        meta_set(pool, "gamelog.offset", &new_offset.to_string()).await;
    }
    if chunk.is_empty() {
        return;
    }

    let account_id = active_account_id(pool).await;
    for line in chunk.lines() {
        if let Some(ev) = parse::parse_line(line) {
            persist_and_emit(app, pool, &account_id, &ev, true).await;
        }
    }
}

/// Un cycle complet : récupère le pool, vérifie l'activation, tail si activé. Best-effort
/// (no-op si DB pas chargée ou lecteur désactivé).
async fn run_tail_cycle(app: &AppHandle) {
    let Some(instances) = app.try_state::<DbInstances>() else {
        return;
    };
    let guard = instances.0.read().await;
    let pool = match guard.get(DB_URL) {
        Some(DbPool::Sqlite(p)) => p,
        _ => return, // DB pas encore chargée
    };
    if meta_get(pool, "gamelog.enabled").await.as_deref() != Some("1") {
        return; // lecteur désactivé (opt-in)
    }
    tail_once(app, pool).await;
}

/// Démarre la surveillance du Game.log. Tourne en permanence mais ne tail QUE si
/// `gamelog.enabled` est vrai. Toggle pris en compte au prochain tick (≤ 2 s).
pub fn spawn_gamelog_watcher(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(BOOT_DELAY_SECS)).await;
        loop {
            run_tail_cycle(&app).await;
            tokio::time::sleep(Duration::from_secs(POLL_INTERVAL_SECS)).await;
        }
    });
}

/* ════════════════════════════════ Commandes ══════════════════════════════ */

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameLogStatus {
    enabled: bool,
    resolved_path: Option<String>,
    path_exists: bool,
    current_location: Option<String>,
    /// Secondes depuis la dernière écriture du Game.log (None si absent) : < 60 s ⇒ jeu en cours.
    log_age_secs: Option<u64>,
}

/// Âge d'un fichier en secondes (0 si l'horloge recule).
pub(crate) fn age_secs(modified: std::time::SystemTime, now: std::time::SystemTime) -> u64 {
    now.duration_since(modified).map(|d| d.as_secs()).unwrap_or(0)
}

#[cfg(test)]
mod age_tests {
    use super::age_secs;
    use std::time::{Duration, SystemTime};

    #[test]
    fn age_en_secondes() {
        let now = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000);
        assert_eq!(age_secs(now - Duration::from_secs(42), now), 42);
    }

    #[test]
    fn horloge_qui_recule() {
        let now = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000);
        assert_eq!(age_secs(now + Duration::from_secs(5), now), 0);
    }
}

/// Extrait le pool SQLite du guard (pattern inline partagé par les commandes).
macro_rules! sqlite_pool {
    ($instances:expr) => {{
        match $instances.get(DB_URL) {
            Some(DbPool::Sqlite(pool)) => pool,
            #[allow(unreachable_patterns)]
            _ => return Err(format!("Base de données non chargée : {DB_URL}")),
        }
    }};
}

/// Statut du lecteur Game.log (activé, chemin résolu, lieu courant).
#[tauri::command]
pub async fn get_gamelog_status(
    db_instances: tauri::State<'_, DbInstances>,
) -> Result<GameLogStatus, String> {
    let instances = db_instances.0.read().await;
    let pool = sqlite_pool!(instances);
    let enabled = meta_get(pool, "gamelog.enabled").await.as_deref() == Some("1");
    let path = resolve_gamelog_path(pool).await;
    let path_exists = path.as_ref().map(|p| p.is_file()).unwrap_or(false);
    let log_age_secs = path
        .as_ref()
        .and_then(|p| std::fs::metadata(p).ok())
        .and_then(|m| m.modified().ok())
        .map(|m| age_secs(m, std::time::SystemTime::now()));
    Ok(GameLogStatus {
        enabled,
        resolved_path: path.map(|p| p.to_string_lossy().to_string()),
        path_exists,
        current_location: meta_get(pool, "gamelog.currentLocation").await,
        log_age_secs,
    })
}

/// Active/désactive le lecteur. À l'activation, on cale l'offset sur la FIN du fichier
/// (on ne rejoue pas tout l'historique comme s'il était neuf — cf. replay_gamelog).
#[tauri::command]
pub async fn set_gamelog_enabled(
    enabled: bool,
    db_instances: tauri::State<'_, DbInstances>,
) -> Result<(), String> {
    let instances = db_instances.0.read().await;
    let pool = sqlite_pool!(instances);
    if enabled {
        if let Some(path) = resolve_gamelog_path(pool).await {
            if let Ok(meta) = std::fs::metadata(&path) {
                meta_set(pool, "gamelog.offset", &meta.len().to_string()).await;
                meta_set(pool, "gamelog.path", &path.to_string_lossy()).await;
            }
        }
    }
    meta_set(pool, "gamelog.enabled", if enabled { "1" } else { "0" }).await;
    Ok(())
}

/// Rejoue l'intégralité du Game.log existant (reconstruction du carnet de bord) :
/// parse tout le fichier et persiste les événements SANS émettre de notification.
/// Renvoie le nombre d'événements reconstruits.
#[tauri::command]
pub async fn replay_gamelog(
    app: AppHandle,
    db_instances: tauri::State<'_, DbInstances>,
) -> Result<i64, String> {
    let instances = db_instances.0.read().await;
    let pool = sqlite_pool!(instances);
    let Some(path) = resolve_gamelog_path(pool).await else {
        return Err("Installation Star Citizen introuvable (Game.log).".into());
    };
    if !path.is_file() {
        return Err(format!("Game.log introuvable : {}", path.display()));
    }
    let account_id = active_account_id(pool).await;
    // Reconstruction propre : on repart de zéro (évite doublons/anciens parasites au re-rejouer).
    let _ = sqlx::query("DELETE FROM GameLogEvent").execute(pool).await;

    // (a) Historique : logbackups/*.log (du plus ANCIEN au plus récent) PUIS le Game.log
    // courant en dernier — pour un ordre chronologique global.
    let mut files: Vec<std::path::PathBuf> = Vec::new();
    if let Some(dir) = path.parent() {
        if let Ok(rd) = std::fs::read_dir(dir.join("logbackups")) {
            let mut entries: Vec<(std::path::PathBuf, std::time::SystemTime)> = rd
                .flatten()
                .map(|e| e.path())
                .filter(|p| {
                    p.extension()
                        .and_then(|x| x.to_str())
                        .map(|x| x.eq_ignore_ascii_case("log"))
                        .unwrap_or(false)
                })
                .map(|p| {
                    let t = std::fs::metadata(&p)
                        .and_then(|m| m.modified())
                        .unwrap_or(std::time::UNIX_EPOCH);
                    (p, t)
                })
                .collect();
            entries.sort_by_key(|(_, t)| *t);
            files.extend(entries.into_iter().map(|(p, _)| p));
        }
    }
    files.push(path.clone()); // Game.log courant = le plus récent

    let mut count = 0i64;
    for f in &files {
        let Ok(content) = std::fs::read(f) else { continue };
        let text = String::from_utf8_lossy(&content);
        for line in text.lines() {
            if let Some(ev) = parse::parse_line(line) {
                persist_and_emit(&app, pool, &account_id, &ev, false).await;
                count += 1;
            }
        }
    }

    // Cale l'offset sur la fin du Game.log courant (pas de re-traitement au prochain tail).
    if let Ok(meta) = std::fs::metadata(&path) {
        meta_set(pool, "gamelog.offset", &meta.len().to_string()).await;
    }
    meta_set(pool, "gamelog.path", &path.to_string_lossy()).await;
    Ok(count)
}

/// Lieu courant détecté (None si inconnu). Utilisé par le GPS de trading (Phase 1.2).
#[tauri::command]
pub async fn get_current_location(
    db_instances: tauri::State<'_, DbInstances>,
) -> Result<Option<String>, String> {
    let instances = db_instances.0.read().await;
    let pool = sqlite_pool!(instances);
    Ok(meta_get(pool, "gamelog.currentLocation").await)
}
