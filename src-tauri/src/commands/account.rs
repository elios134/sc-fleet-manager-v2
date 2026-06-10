use serde_json::{json, Value};
use sqlx::Row;
use tauri::State;
use tauri_plugin_sql::{DbInstances, DbPool};

const DB_URL: &str = "sqlite:scfleet.db";

/// Upsert de l'id de compte actif dans AppMeta. Partagé par set_active_account
/// et create_account.
async fn upsert_active(pool: &sqlx::SqlitePool, account_id: &str) -> Result<(), String> {
    sqlx::query("INSERT OR REPLACE INTO AppMeta (key, value) VALUES ('rsiAccount.activeId', ?)")
        .bind(account_id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn get_accounts(db_instances: State<'_, DbInstances>) -> Result<Vec<Value>, String> {
    let instances = db_instances.0.read().await;
    let db = instances
        .get(DB_URL)
        .ok_or_else(|| format!("Base de données non chargée : {DB_URL}"))?;

    let pool = match db {
        DbPool::Sqlite(pool) => pool,
        #[allow(unreachable_patterns)]
        _ => return Err("Connexion SQLite attendue".into()),
    };

    let rows =
        sqlx::query("SELECT id, handle, displayName, avatarUrl FROM RsiAccount ORDER BY handle ASC")
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?;

    let accounts = rows
        .iter()
        .map(|row| {
            json!({
                "id": row.try_get::<i64, _>("id").ok(),
                "handle": row.try_get::<String, _>("handle").ok(),
                "displayName": row.try_get::<Option<String>, _>("displayName").ok().flatten(),
                "avatarUrl": row.try_get::<Option<String>, _>("avatarUrl").ok().flatten(),
            })
        })
        .collect();

    Ok(accounts)
}

#[tauri::command]
pub async fn get_active_account_id(
    db_instances: State<'_, DbInstances>,
) -> Result<Option<String>, String> {
    let instances = db_instances.0.read().await;
    let db = instances
        .get(DB_URL)
        .ok_or_else(|| format!("Base de données non chargée : {DB_URL}"))?;

    let pool = match db {
        DbPool::Sqlite(pool) => pool,
        #[allow(unreachable_patterns)]
        _ => return Err("Connexion SQLite attendue".into()),
    };

    let row = sqlx::query("SELECT value FROM AppMeta WHERE key = 'rsiAccount.activeId'")
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(row.and_then(|r| r.try_get::<String, _>("value").ok()))
}

#[tauri::command]
pub async fn set_active_account(
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

    upsert_active(pool, &account_id).await
}

#[tauri::command]
pub async fn create_account(
    handle: String,
    display_name: Option<String>,
    db_instances: State<'_, DbInstances>,
) -> Result<Value, String> {
    let instances = db_instances.0.read().await;
    let db = instances
        .get(DB_URL)
        .ok_or_else(|| format!("Base de données non chargée : {DB_URL}"))?;

    let pool = match db {
        DbPool::Sqlite(pool) => pool,
        #[allow(unreachable_patterns)]
        _ => return Err("Connexion SQLite attendue".into()),
    };

    // RsiAccount.id est INTEGER PRIMARY KEY AUTOINCREMENT (cf. migration 0001) :
    // l'id est généré par SQLite, pas fourni. RETURNING récupère la ligne créée.
    let row = sqlx::query(
        "INSERT INTO RsiAccount (handle, displayName, createdAt)
         VALUES (?, ?, datetime('now'))
         RETURNING id, handle, displayName",
    )
    .bind(&handle)
    .bind(&display_name)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;

    let id = row.try_get::<i64, _>("id").map_err(|e| e.to_string())?;
    let created_handle = row.try_get::<String, _>("handle").map_err(|e| e.to_string())?;
    let created_display = row
        .try_get::<Option<String>, _>("displayName")
        .map_err(|e| e.to_string())?;

    // accountId est stocké en TEXT côté Ship/Pledge : on persiste l'id sous forme
    // de chaîne dans AppMeta pour rester cohérent avec get_ships/get_fleet_stats.
    upsert_active(pool, &id.to_string()).await?;

    Ok(json!({
        "id": id,
        "handle": created_handle,
        "displayName": created_display,
    }))
}
