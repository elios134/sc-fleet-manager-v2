// Inventaire — couche I/O : persistance (blob JSON), tail incrémental du Game.log,
// import historique, commandes Tauri. LECTURE SEULE du log (aucune écriture jeu).
use serde::Serialize;
use sqlx::{Row, SqlitePool};
use std::io::{Read, Seek, SeekFrom};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_sql::{DbInstances, DbPool};

use crate::commands::gamelog::{meta_get, resolve_gamelog_path};
use crate::commands::inventory::apply::rejouer_lignes;
use crate::commands::inventory::model::Etat;
use crate::commands::inventory::session::reprise;
use crate::DB_URL;

const POLL: u64 = 3;
const BOOT_DELAY: u64 = 10;
const MAX_CHUNK: u64 = 4 * 1024 * 1024;

async fn charge(pool: &SqlitePool) -> Etat {
    let row = sqlx::query("SELECT json FROM InventoryState WHERE id = 1")
        .fetch_optional(pool).await.ok().flatten();
    row.and_then(|r| r.try_get::<String, _>("json").ok())
        .and_then(|s| serde_json::from_str::<Etat>(&s).ok())
        .unwrap_or_default()
}

async fn sauve(pool: &SqlitePool, etat: &Etat) {
    if let Ok(json) = serde_json::to_string(etat) {
        let _ = sqlx::query(
            "INSERT INTO InventoryState(id, json, updatedAt) VALUES (1, ?, datetime('now')) \
             ON CONFLICT(id) DO UPDATE SET json = excluded.json, updatedAt = excluded.updatedAt",
        ).bind(json).execute(pool).await;
    }
}

fn journal_id(path: &std::path::Path) -> String {
    let nom = path.file_name().and_then(|n| n.to_str()).unwrap_or("Game.log");
    let t = std::fs::metadata(path).and_then(|m| m.modified()).ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs_f64()).unwrap_or(0.0);
    format!("{nom}|{t:.3}")
}

macro_rules! pool_of {
    ($g:expr) => {{
        match $g.get(DB_URL) {
            Some(DbPool::Sqlite(p)) => p,
            #[allow(unreachable_patterns)]
            _ => return Err(format!("DB non chargée : {DB_URL}")),
        }
    }};
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryStatus { active: bool, derniere_trace: Option<i64>, has_game_log: bool }

/// État complet (l'UI filtre/agrège).
#[tauri::command]
pub async fn inventory_state(db: tauri::State<'_, DbInstances>) -> Result<Etat, String> {
    let g = db.0.read().await;
    let pool = pool_of!(g);
    Ok(charge(pool).await)
}

#[tauri::command]
pub async fn inventory_status(db: tauri::State<'_, DbInstances>) -> Result<InventoryStatus, String> {
    let g = db.0.read().await;
    let pool = pool_of!(g);
    let active = meta_get(pool, "gamelog.enabled").await.as_deref() == Some("1");
    let has = resolve_gamelog_path(pool).await.map(|p| p.is_file()).unwrap_or(false);
    Ok(InventoryStatus { active, derniere_trace: charge(pool).await.derniere_trace, has_game_log: has })
}

#[tauri::command]
pub async fn inventory_clear(app: AppHandle, db: tauri::State<'_, DbInstances>) -> Result<Etat, String> {
    let g = db.0.read().await;
    let pool = pool_of!(g);
    let e = Etat::default();
    sauve(pool, &e).await;
    let _ = app.emit("inventory:updated", ());
    Ok(e)
}

#[tauri::command]
pub async fn inventory_import_history(app: AppHandle, db: tauri::State<'_, DbInstances>) -> Result<Etat, String> {
    let g = db.0.read().await;
    let pool = pool_of!(g);
    let Some(path) = resolve_gamelog_path(pool).await else {
        return Err("Installation Star Citizen introuvable.".into());
    };
    let mut files: Vec<std::path::PathBuf> = Vec::new();
    if let Some(dir) = path.parent() {
        if let Ok(rd) = std::fs::read_dir(dir.join("logbackups")) {
            let mut v: Vec<(std::path::PathBuf, std::time::SystemTime)> = rd.flatten().map(|e| e.path())
                .filter(|p| p.extension().and_then(|x| x.to_str()).map(|x| x.eq_ignore_ascii_case("log")).unwrap_or(false))
                .map(|p| { let t = std::fs::metadata(&p).and_then(|m| m.modified()).unwrap_or(std::time::UNIX_EPOCH); (p, t) })
                .collect();
            v.sort_by_key(|(_, t)| *t);
            files.extend(v.into_iter().map(|(p, _)| p));
        }
    }
    files.push(path.clone());
    let mut etat = Etat::default();
    for f in &files {
        if let Ok(bytes) = std::fs::read(f) {
            let text = String::from_utf8_lossy(&bytes);
            rejouer_lignes(&mut etat, text.lines());
        }
    }
    if let Ok(m) = std::fs::metadata(&path) {
        etat.journal_id = Some(journal_id(&path));
        etat.journal_pos = m.len();
    }
    sauve(pool, &etat).await;
    let _ = app.emit("inventory:updated", ());
    Ok(etat)
}

/// Tail incrémental : lit depuis l'offset repris, applique les nouvelles lignes, persiste.
async fn tail_cycle(app: &AppHandle) {
    let instances = app.state::<DbInstances>();
    let g = instances.0.read().await;
    let pool = match g.get(DB_URL) { Some(DbPool::Sqlite(p)) => p, _ => return };
    if meta_get(pool, "gamelog.enabled").await.as_deref() != Some("1") { return; }
    let Some(path) = resolve_gamelog_path(pool).await else { return };
    let Ok(meta) = std::fs::metadata(&path) else { return };
    let mut etat = charge(pool).await;
    let jid = journal_id(&path);
    let start = reprise(&etat, &jid, meta.len());
    if start >= meta.len() && etat.journal_id.as_deref() == Some(jid.as_str()) { return; }
    let Ok(mut f) = std::fs::File::open(&path) else { return };
    if f.seek(SeekFrom::Start(start)).is_err() { return; }
    let mut buf = String::new();
    if f.take(MAX_CHUNK).read_to_string(&mut buf).is_err() { return; }
    rejouer_lignes(&mut etat, buf.lines());
    etat.journal_id = Some(jid);
    etat.journal_pos = meta.len();
    sauve(pool, &etat).await;
    let _ = app.emit("inventory:updated", ());
}

pub fn spawn_inventory_watcher(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(BOOT_DELAY)).await;
        loop {
            tail_cycle(&app).await;
            tokio::time::sleep(Duration::from_secs(POLL)).await;
        }
    });
}
