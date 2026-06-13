// Socle notifications (Lot 1) : historique en base + envoi système (gated) + event front.
// `create_notification` est la commande centrale réutilisée par les déclencheurs (Lot 4).
// L'entrée en base est TOUJOURS créée ; l'envoi OS dépend du canal « Système » (AppSettings).

use serde_json::{json, Value};
use sqlx::sqlite::SqliteRow;
use sqlx::{Row, SqlitePool};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_sql::{DbInstances, DbPool};

const DB_URL: &str = "sqlite:scfleet.db";

macro_rules! sqlite_pool {
    ($instances:expr) => {{
        let db = $instances
            .get(DB_URL)
            .ok_or_else(|| format!("Base de données non chargée : {DB_URL}"))?;
        match db {
            DbPool::Sqlite(pool) => pool,
            #[allow(unreachable_patterns)]
            _ => return Err("Connexion SQLite attendue".into()),
        }
    }};
}

/// Compte actif (AppMeta), ou None si aucun.
async fn active_account_id(pool: &SqlitePool) -> Result<Option<String>, String> {
    let row = sqlx::query("SELECT value FROM AppMeta WHERE key = 'rsiAccount.activeId'")
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(row.and_then(|r| r.try_get::<String, _>("value").ok()))
}

/// Canal « Système » activé ? (AppSettings.notifSystem, défaut true.)
async fn notif_system_enabled(pool: &SqlitePool) -> bool {
    let row = sqlx::query("SELECT notifSystem FROM AppSettings WHERE id = 'singleton'")
        .fetch_optional(pool)
        .await
        .ok()
        .flatten();
    match row {
        Some(r) => r
            .try_get::<Option<i64>, _>("notifSystem")
            .ok()
            .flatten()
            .map(|v| v != 0)
            .unwrap_or(true),
        None => true,
    }
}

fn notif_row_json(r: &SqliteRow) -> Result<Value, String> {
    Ok(json!({
        "id": r.try_get::<i64, _>("id").map_err(|e| e.to_string())?,
        "type": r.try_get::<String, _>("type").map_err(|e| e.to_string())?,
        "title": r.try_get::<String, _>("title").map_err(|e| e.to_string())?,
        "body": r.try_get::<String, _>("body").map_err(|e| e.to_string())?,
        "relatedShipId": r.try_get::<Option<i64>, _>("relatedShipId").ok().flatten(),
        "firedAt": r.try_get::<String, _>("firedAt").map_err(|e| e.to_string())?,
        "readAt": r.try_get::<Option<String>, _>("readAt").ok().flatten(),
    }))
}

/// Insère la notif, envoie l'OS (si canal système on), émet l'event front. Renvoie l'entrée.
async fn insert_and_dispatch(
    app: &AppHandle,
    pool: &SqlitePool,
    account_id: &str,
    notif_type: &str,
    title: &str,
    body: &str,
    related_ship_id: Option<i64>,
) -> Result<Value, String> {
    let res = sqlx::query(
        "INSERT INTO Notification (accountId, type, title, body, relatedShipId, firedAt, readAt)
         VALUES (?, ?, ?, ?, ?, datetime('now'), NULL)",
    )
    .bind(account_id)
    .bind(notif_type)
    .bind(title)
    .bind(body)
    .bind(related_ship_id)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    let id = res.last_insert_rowid();

    let row = sqlx::query(
        "SELECT id, type, title, body, relatedShipId, firedAt, readAt
         FROM Notification WHERE id = ?",
    )
    .bind(id)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;
    let payload = notif_row_json(&row)?;

    // Canal « Système » : envoi OS best-effort (n'échoue jamais la commande).
    if notif_system_enabled(pool).await {
        let _ = app
            .notification()
            .builder()
            .title(title)
            .body(body)
            .show();
    }

    // Event front (consommé par la cloche/toast aux lots suivants).
    let _ = app.emit("notification:new", payload.clone());

    Ok(payload)
}

/// Commande centrale : crée une notif (entrée base toujours + OS gated + event).
#[tauri::command]
pub async fn create_notification(
    app: AppHandle,
    r#type: String,
    title: String,
    body: String,
    related_ship_id: Option<i64>,
    db_instances: State<'_, DbInstances>,
) -> Result<Value, String> {
    let instances = db_instances.0.read().await;
    let pool = sqlite_pool!(instances);
    let account_id = active_account_id(pool)
        .await?
        .ok_or_else(|| "Aucun compte actif.".to_string())?;
    insert_and_dispatch(&app, pool, &account_id, &r#type, &title, &body, related_ship_id).await
}

/// Envoi de test de bout en bout (bouton « Tester » des réglages).
#[tauri::command]
pub async fn send_test_notification(
    app: AppHandle,
    db_instances: State<'_, DbInstances>,
) -> Result<Value, String> {
    let instances = db_instances.0.read().await;
    let pool = sqlite_pool!(instances);
    let account_id = active_account_id(pool)
        .await?
        .ok_or_else(|| "Aucun compte actif.".to_string())?;
    insert_and_dispatch(
        &app,
        pool,
        &account_id,
        "test",
        "SC Fleet Manager",
        "Ceci est une notification de test.",
        None,
    )
    .await
}

/// Les N dernières notifs du compte actif (firedAt desc).
#[tauri::command]
pub async fn list_notifications(
    limit: Option<i64>,
    db_instances: State<'_, DbInstances>,
) -> Result<Value, String> {
    let instances = db_instances.0.read().await;
    let pool = sqlite_pool!(instances);
    let Some(account_id) = active_account_id(pool).await? else {
        return Ok(Value::Array(vec![]));
    };
    let limit = limit.unwrap_or(50).clamp(1, 500);
    let rows = sqlx::query(
        "SELECT id, type, title, body, relatedShipId, firedAt, readAt
         FROM Notification WHERE accountId = ?
         ORDER BY firedAt DESC, id DESC LIMIT ?",
    )
    .bind(&account_id)
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;
    let out: Vec<Value> = rows
        .iter()
        .map(notif_row_json)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Value::Array(out))
}

/// Nombre de non-lues du compte actif.
#[tauri::command]
pub async fn unread_count(db_instances: State<'_, DbInstances>) -> Result<i64, String> {
    let instances = db_instances.0.read().await;
    let pool = sqlite_pool!(instances);
    let Some(account_id) = active_account_id(pool).await? else {
        return Ok(0);
    };
    let row = sqlx::query(
        "SELECT COUNT(*) AS c FROM Notification WHERE accountId = ? AND readAt IS NULL",
    )
    .bind(&account_id)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(row.try_get::<i64, _>("c").unwrap_or(0))
}

/// Marque une notif lue (scopée au compte actif).
#[tauri::command]
pub async fn mark_notification_read(
    id: i64,
    db_instances: State<'_, DbInstances>,
) -> Result<(), String> {
    let instances = db_instances.0.read().await;
    let pool = sqlite_pool!(instances);
    let Some(account_id) = active_account_id(pool).await? else {
        return Ok(());
    };
    sqlx::query(
        "UPDATE Notification SET readAt = datetime('now')
         WHERE id = ? AND accountId = ? AND readAt IS NULL",
    )
    .bind(id)
    .bind(&account_id)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Marque toutes les non-lues comme lues ; renvoie le nombre affecté.
#[tauri::command]
pub async fn mark_all_read(db_instances: State<'_, DbInstances>) -> Result<i64, String> {
    let instances = db_instances.0.read().await;
    let pool = sqlite_pool!(instances);
    let Some(account_id) = active_account_id(pool).await? else {
        return Ok(0);
    };
    let res = sqlx::query(
        "UPDATE Notification SET readAt = datetime('now')
         WHERE accountId = ? AND readAt IS NULL",
    )
    .bind(&account_id)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(res.rows_affected() as i64)
}

/// Supprime une notif (scopée au compte actif).
#[tauri::command]
pub async fn delete_notification(
    id: i64,
    db_instances: State<'_, DbInstances>,
) -> Result<(), String> {
    let instances = db_instances.0.read().await;
    let pool = sqlite_pool!(instances);
    let Some(account_id) = active_account_id(pool).await? else {
        return Ok(());
    };
    sqlx::query("DELETE FROM Notification WHERE id = ? AND accountId = ?")
        .bind(id)
        .bind(&account_id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}
