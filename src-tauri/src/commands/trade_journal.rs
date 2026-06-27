// Phase 1.3 — Journal de commerce (P&L réel des trajets).
//
// Transactions cargo saisies à la main OU détectées via le Game.log (cf. gamelog.rs).
// Scopé au compte actif (AppMeta rsiAccount.activeId), comme les notifications.

use serde_json::{json, Value};
use sqlx::{Row, SqlitePool};
use tauri::State;
use tauri_plugin_sql::{DbInstances, DbPool};

use crate::DB_URL;

macro_rules! sqlite_pool {
    ($instances:expr) => {{
        match $instances.get(DB_URL) {
            Some(DbPool::Sqlite(pool)) => pool,
            #[allow(unreachable_patterns)]
            _ => return Err(format!("Base de données non chargée : {DB_URL}")),
        }
    }};
}

async fn active_account_id(pool: &SqlitePool) -> Option<String> {
    sqlx::query("SELECT value FROM AppMeta WHERE key = 'rsiAccount.activeId'")
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
        .and_then(|r| r.try_get::<String, _>("value").ok())
}

fn row_json(r: &sqlx::sqlite::SqliteRow) -> Value {
    json!({
        "id": r.try_get::<i64, _>("id").unwrap_or(0),
        "action": r.try_get::<String, _>("action").unwrap_or_default(),
        "commodity": r.try_get::<String, _>("commodity").unwrap_or_default(),
        "scu": r.try_get::<Option<f64>, _>("scu").ok().flatten(),
        "unitPrice": r.try_get::<Option<f64>, _>("unitPrice").ok().flatten(),
        "totalPrice": r.try_get::<Option<f64>, _>("totalPrice").ok().flatten(),
        "location": r.try_get::<Option<String>, _>("location").ok().flatten(),
        "source": r.try_get::<String, _>("source").unwrap_or_default(),
        "occurredAt": r.try_get::<Option<String>, _>("occurredAt").ok().flatten(),
        "createdAt": r.try_get::<Option<String>, _>("createdAt").ok().flatten(),
    })
}

/// Ajoute une transaction manuelle. Le total est calculé si absent (scu × unitPrice).
#[tauri::command]
pub async fn add_trade_journal_entry(
    action: String,
    commodity: String,
    scu: Option<f64>,
    unit_price: Option<f64>,
    total_price: Option<f64>,
    location: Option<String>,
    db_instances: State<'_, DbInstances>,
) -> Result<Value, String> {
    if action != "buy" && action != "sell" {
        return Err("Action invalide (buy|sell).".into());
    }
    if commodity.trim().is_empty() {
        return Err("Marchandise requise.".into());
    }
    let instances = db_instances.0.read().await;
    let pool = sqlite_pool!(instances);
    let account_id = active_account_id(pool).await;
    let total = total_price.or_else(|| match (scu, unit_price) {
        (Some(s), Some(u)) => Some(s * u),
        _ => None,
    });
    let res = sqlx::query(
        "INSERT INTO TradeJournal (accountId, action, commodity, scu, unitPrice, totalPrice, location, source, occurredAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'manual', datetime('now'))",
    )
    .bind(&account_id)
    .bind(&action)
    .bind(commodity.trim())
    .bind(scu)
    .bind(unit_price)
    .bind(total)
    .bind(&location)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    let row = sqlx::query("SELECT * FROM TradeJournal WHERE id = ?")
        .bind(res.last_insert_rowid())
        .fetch_one(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(row_json(&row))
}

/// Liste les N dernières transactions du compte actif (plus récentes d'abord).
#[tauri::command]
pub async fn list_trade_journal(
    limit: Option<i64>,
    db_instances: State<'_, DbInstances>,
) -> Result<Vec<Value>, String> {
    let instances = db_instances.0.read().await;
    let pool = sqlite_pool!(instances);
    let account_id = active_account_id(pool).await;
    let limit = limit.unwrap_or(100).clamp(1, 1000);
    // Inclut les entrées sans compte (account_id NULL) pour ne rien masquer.
    let rows = sqlx::query(
        "SELECT * FROM TradeJournal
         WHERE accountId IS ? OR accountId IS NULL
         ORDER BY id DESC LIMIT ?",
    )
    .bind(&account_id)
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(rows.iter().map(row_json).collect())
}

/// Supprime une entrée.
#[tauri::command]
pub async fn delete_trade_journal_entry(
    id: i64,
    db_instances: State<'_, DbInstances>,
) -> Result<(), String> {
    let instances = db_instances.0.read().await;
    let pool = sqlite_pool!(instances);
    sqlx::query("DELETE FROM TradeJournal WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Agrégats P&L du compte actif : total achats, total ventes, profit net, nb transactions.
#[tauri::command]
pub async fn get_trade_journal_stats(
    db_instances: State<'_, DbInstances>,
) -> Result<Value, String> {
    let instances = db_instances.0.read().await;
    let pool = sqlite_pool!(instances);
    let account_id = active_account_id(pool).await;
    let row = sqlx::query(
        "SELECT
           COALESCE(SUM(CASE WHEN action='buy'  THEN totalPrice ELSE 0 END), 0) AS spent,
           COALESCE(SUM(CASE WHEN action='sell' THEN totalPrice ELSE 0 END), 0) AS earned,
           COUNT(*) AS n
         FROM TradeJournal
         WHERE accountId IS ? OR accountId IS NULL",
    )
    .bind(&account_id)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;
    let spent = row.try_get::<f64, _>("spent").unwrap_or(0.0);
    let earned = row.try_get::<f64, _>("earned").unwrap_or(0.0);
    let n = row.try_get::<i64, _>("n").unwrap_or(0);
    Ok(json!({ "spent": spent, "earned": earned, "profit": earned - spent, "count": n }))
}
