use serde_json::{json, Value};
use sqlx::{Column, Row};
use tauri::State;
use tauri_plugin_sql::{DbInstances, DbPool};

use crate::DB_URL;

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
pub async fn get_all_ship_data(
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

    let rows = sqlx::query(
        "SELECT id, wikiId, name, manufacturer, role, classification, focus, size,
                length, beam, height, maxSpeed, scmSpeed, shieldHp, hullHp, baseDps,
                cargoScu, quantumFuel, quantumRange, crewMin, crewMax, mass, priceUec,
                imageUrl, imageTopDownUrl,
                radarSpeed, radarFirepower, radarDefense, radarRange, radarAgility, radarUtility,
                emSignature, irSignature, crossSection, lastSyncedAt
         FROM ShipData
         ORDER BY name ASC",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows.iter().map(row_to_json).collect())
}
