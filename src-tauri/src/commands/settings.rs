use serde_json::{json, Value};
use sqlx::{Column, Row};
use tauri::State;
use tauri_plugin_sql::{DbInstances, DbPool};

const DB_URL: &str = "sqlite:scfleet.db";

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
pub async fn delete_account(
    account_id: String,
    db_instances: State<'_, DbInstances>,
) -> Result<(), String> {
    let instances = db_instances.0.read().await;
    let db = instances
        .get(DB_URL)
        .ok_or_else(|| format!("Base de données non chargée : {DB_URL}"))?;

    let pool = match db {
        DbPool::Sqlite(pool) => pool,
        #[allow(unreachable_patterns)]
        _ => return Err("Connexion SQLite attendue".into()),
    };

    // Si le compte supprimé est le compte actif, on retire aussi le pointeur AppMeta.
    let active = sqlx::query("SELECT value FROM AppMeta WHERE key = 'rsiAccount.activeId'")
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?
        .and_then(|r| r.try_get::<String, _>("value").ok());

    if active.as_deref() == Some(account_id.as_str()) {
        sqlx::query("DELETE FROM AppMeta WHERE key = 'rsiAccount.activeId'")
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;
    }

    sqlx::query("DELETE FROM RsiAccount WHERE id = ?")
        .bind(&account_id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn get_app_settings(db_instances: State<'_, DbInstances>) -> Result<Value, String> {
    let instances = db_instances.0.read().await;
    let db = instances
        .get(DB_URL)
        .ok_or_else(|| format!("Base de données non chargée : {DB_URL}"))?;

    let pool = match db {
        DbPool::Sqlite(pool) => pool,
        #[allow(unreachable_patterns)]
        _ => return Err("Connexion SQLite attendue".into()),
    };

    let row = sqlx::query("SELECT * FROM AppSettings WHERE id = 'singleton'")
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?;

    match row {
        Some(r) => Ok(row_to_json(&r)),
        None => Ok(json!({
            "accentColor": "#6366f1",
            "density": "normal",
            "animationsEnabled": 1,
            "hudGlowIntensity": 75,
        })),
    }
}

#[tauri::command]
pub async fn update_app_settings(
    key: String,
    value: String,
    db_instances: State<'_, DbInstances>,
) -> Result<(), String> {
    let instances = db_instances.0.read().await;
    let db = instances
        .get(DB_URL)
        .ok_or_else(|| format!("Base de données non chargée : {DB_URL}"))?;

    let pool = match db {
        DbPool::Sqlite(pool) => pool,
        #[allow(unreachable_patterns)]
        _ => return Err("Connexion SQLite attendue".into()),
    };

    // Garantit l'existence de la ligne singleton (toutes les autres colonnes
    // prennent leurs valeurs par défaut définies dans la migration 0008).
    sqlx::query(
        "INSERT INTO AppSettings (id, accentColor, density, animationsEnabled, hudGlowIntensity, updatedAt)
         VALUES ('singleton', '#6366f1', 'normal', 1, 75, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET updatedAt = datetime('now')",
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    // Applique dynamiquement la clé demandée. Liste blanche pour éviter toute
    // injection de nom de colonne.
    let sql = match key.as_str() {
        "accentColor" => "UPDATE AppSettings SET accentColor = ? WHERE id = 'singleton'",
        "density" => "UPDATE AppSettings SET density = ? WHERE id = 'singleton'",
        "animationsEnabled" => {
            "UPDATE AppSettings SET animationsEnabled = ? WHERE id = 'singleton'"
        }
        "hudGlowIntensity" => "UPDATE AppSettings SET hudGlowIntensity = ? WHERE id = 'singleton'",
        other => return Err(format!("Clé de réglage inconnue : {other}")),
    };

    sqlx::query(sql)
        .bind(&value)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}
