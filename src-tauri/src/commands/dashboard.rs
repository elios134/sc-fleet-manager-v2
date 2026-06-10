use serde::Serialize;
use serde_json::{json, Value};
use sqlx::{Column, Row};
use tauri::State;
use tauri_plugin_sql::{DbInstances, DbPool};

const DB_URL: &str = "sqlite:scfleet.db";

#[derive(Serialize)]
#[allow(non_snake_case)]
pub struct DashboardData {
    shipsCount: i64,
    totalValueUsd: f64,
    ltiCount: i64,
    lastSyncedAt: Option<String>,
    recentShips: Vec<Value>,
}

fn row_to_json(row: &sqlx::sqlite::SqliteRow) -> Value {
    let mut obj = serde_json::Map::new();
    for (i, col) in row.columns().iter().enumerate() {
        let name = col.name().to_string();
        let value = if let Ok(v) = row.try_get::<Option<i64>, _>(i) {
            v.map(|n| json!(n)).unwrap_or(Value::Null)
        } else if let Ok(v) = row.try_get::<Option<f64>, _>(i) {
            v.map(|n| json!(n)).unwrap_or(Value::Null)
        } else if let Ok(v) = row.try_get::<Option<String>, _>(i) {
            v.map(Value::String).unwrap_or(Value::Null)
        } else {
            Value::Null
        };
        obj.insert(name, value);
    }
    Value::Object(obj)
}

#[tauri::command]
pub async fn get_dashboard_data(
    account_id: String,
    db_instances: State<'_, DbInstances>,
) -> Result<DashboardData, String> {
    let instances = db_instances.0.read().await;
    let db = instances
        .get(DB_URL)
        .ok_or_else(|| format!("Base de données non chargée : {DB_URL}"))?;

    let pool = match db {
        DbPool::Sqlite(pool) => pool,
        #[allow(unreachable_patterns)]
        _ => return Err("Connexion SQLite attendue".into()),
    };

    // Requête 1 — stats flotte
    let stats_row = sqlx::query(
        "SELECT
           COUNT(*) as ships_count,
           SUM(p.currentValueUsd) as total_value_usd,
           SUM(CASE WHEN p.lti = 1 THEN 1 ELSE 0 END) as lti_count
         FROM PledgeShip ps
         JOIN Pledge p ON p.id = ps.pledgeId
         WHERE p.accountId = ?",
    )
    .bind(&account_id)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;

    let ships_count = stats_row
        .try_get::<i64, _>("ships_count")
        .map_err(|e| e.to_string())?;
    let total_value_usd = stats_row
        .try_get::<Option<f64>, _>("total_value_usd")
        .map_err(|e| e.to_string())?
        .unwrap_or(0.0);
    let lti_count = stats_row
        .try_get::<Option<i64>, _>("lti_count")
        .map_err(|e| e.to_string())?
        .unwrap_or(0);

    // Requête 2 — dernière sync
    let last_synced_at = sqlx::query("SELECT value FROM AppMeta WHERE key = 'rsi.lastSyncedAt'")
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?
        .and_then(|r| r.try_get::<String, _>("value").ok());

    // Requête 3 — 6 vaisseaux récents (Quick Launch Bay)
    let recent_rows = sqlx::query(
        "SELECT s.id, s.name, s.manufacturer,
                sd.imageUrl, sd.role as shipDataRole,
                sd.classification as shipDataClassification
         FROM Ship s
         LEFT JOIN ShipData sd ON sd.name = s.name
         WHERE s.accountId = ?
         ORDER BY s.createdAt DESC
         LIMIT 6",
    )
    .bind(&account_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let recent_ships = recent_rows.iter().map(row_to_json).collect();

    Ok(DashboardData {
        shipsCount: ships_count,
        totalValueUsd: total_value_usd,
        ltiCount: lti_count,
        lastSyncedAt: last_synced_at,
        recentShips: recent_ships,
    })
}
