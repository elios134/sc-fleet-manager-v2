use serde::Serialize;
use serde_json::{json, Value};
use sqlx::{Column, Row};
use tauri::State;
use tauri_plugin_sql::{DbInstances, DbPool};

const DB_URL: &str = "sqlite:scfleet.db";

#[derive(Serialize)]
#[allow(non_snake_case)]
pub struct FleetStats {
    totalFleetValueUsd: f64,
    shipsOwnedCount: i64,
    ltiAssetsCount: i64,
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
pub async fn get_ships(
    account_id: String,
    db_instances: State<'_, DbInstances>,
) -> Result<Vec<Value>, String> {
    let instances = db_instances.0.read().await;
    let db = instances
        .get(DB_URL)
        .ok_or_else(|| format!("Base de données non chargée : {DB_URL}"))?;

    let pool = match db {
        DbPool::Sqlite(pool) => pool,
        #[allow(unreachable_patterns)]
        _ => return Err("Connexion SQLite attendue".into()),
    };

    let sql = r#"
        SELECT
          s.id, s.name, s.manufacturer, s.role, s.lti, s.insuranceExpiry,
          s.insuranceDuration, s.purchasePrice, s.notes, s.importedFromRsi,
          s.rsiPledgeId, s.rsiSyncedAt, s.createdAt, s.updatedAt,
          sd.imageUrl, sd.imageTopDownUrl, sd.role as shipDataRole,
          sd.manufacturer as shipDataManufacturer, sd.classification as shipDataClassification
        FROM Ship s
        LEFT JOIN ShipData sd ON sd.name = s.name
        WHERE s.accountId = ?
        ORDER BY s.name ASC
    "#;

    let rows = sqlx::query(sql)
        .bind(account_id)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(rows.iter().map(row_to_json).collect())
}

#[tauri::command]
pub async fn get_fleet_stats(
    account_id: String,
    db_instances: State<'_, DbInstances>,
) -> Result<FleetStats, String> {
    let instances = db_instances.0.read().await;
    let db = instances
        .get(DB_URL)
        .ok_or_else(|| format!("Base de données non chargée : {DB_URL}"))?;

    let pool = match db {
        DbPool::Sqlite(pool) => pool,
        #[allow(unreachable_patterns)]
        _ => return Err("Connexion SQLite attendue".into()),
    };

    let total_row = sqlx::query(
        "SELECT SUM(p.currentValueUsd) as total FROM Pledge p WHERE p.accountId = ?",
    )
    .bind(&account_id)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;

    let ships_row = sqlx::query(
        "SELECT COUNT(*) as count FROM PledgeShip ps
         JOIN Pledge p ON p.id = ps.pledgeId WHERE p.accountId = ?",
    )
    .bind(&account_id)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;

    let lti_row = sqlx::query(
        "SELECT COUNT(*) as count FROM PledgeShip ps
         JOIN Pledge p ON p.id = ps.pledgeId WHERE p.accountId = ? AND p.lti = 1",
    )
    .bind(&account_id)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;

    let total_fleet_value_usd = total_row
        .try_get::<Option<f64>, _>("total")
        .map_err(|e| e.to_string())?
        .unwrap_or(0.0);

    let ships_owned_count = ships_row
        .try_get::<i64, _>("count")
        .map_err(|e| e.to_string())?;

    let lti_assets_count = lti_row
        .try_get::<i64, _>("count")
        .map_err(|e| e.to_string())?;

    Ok(FleetStats {
        totalFleetValueUsd: total_fleet_value_usd,
        shipsOwnedCount: ships_owned_count,
        ltiAssetsCount: lti_assets_count,
    })
}
