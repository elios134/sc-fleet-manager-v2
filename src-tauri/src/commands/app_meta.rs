// Helpers AppMeta (table clé/valeur) centralisés. Remplacent les copies locales
// auparavant dupliquées dans news/notifications/patch_detect/datamining/uex.
use sqlx::{Row, SqlitePool};

/// Lit une valeur AppMeta (None si absente).
pub async fn get(pool: &SqlitePool, key: &str) -> Option<String> {
    sqlx::query("SELECT value FROM AppMeta WHERE key = ?")
        .bind(key)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
        .and_then(|r| r.try_get::<String, _>("value").ok())
}

/// Écrit (upsert) une valeur AppMeta.
pub async fn set(pool: &SqlitePool, key: &str, value: &str) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO AppMeta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(key)
    .bind(value)
    .execute(pool)
    .await
    .map(|_| ())
    .map_err(|e| e.to_string())
}
