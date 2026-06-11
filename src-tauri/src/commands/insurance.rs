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

/// Tous les vaisseaux d'un compte avec leurs champs d'assurance (la page Insurance
/// dérive statut/jours restants côté JS, comme le store V1). Contrairement à
/// get_ships, n'exclut PAS les vaisseaux de pack : l'assurance concerne chaque vaisseau.
#[tauri::command]
pub async fn get_insurance_ships(
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

    let rows = sqlx::query(
        "SELECT id, name, manufacturer, lti, insuranceDuration, insuranceExpiry
         FROM Ship
         WHERE accountId = ?
         ORDER BY name ASC",
    )
    .bind(account_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows.iter().map(row_to_json).collect())
}

/// Renouvelle (ou passe en LTI) l'assurance d'un vaisseau. Réplique insurance:renew V1 :
/// écrit insuranceExpiry (ISO ou null pour LTI) + insuranceDuration. Vérifie que le
/// vaisseau appartient bien au compte actif.
#[tauri::command]
pub async fn renew_insurance(
    ship_id: i64,
    new_expiry_iso: Option<String>,
    insurance_duration: Option<i64>,
    db_instances: State<'_, DbInstances>,
) -> Result<(), String> {
    if ship_id <= 0 {
        return Err("Identifiant de vaisseau invalide".into());
    }
    if let Some(d) = insurance_duration {
        if d < 1 {
            return Err("Durée d'assurance invalide (entier positif attendu)".into());
        }
    }

    let instances = db_instances.0.read().await;
    let db = instances
        .get(DB_URL)
        .ok_or_else(|| format!("Base de données non chargée : {DB_URL}"))?;
    let pool = match db {
        DbPool::Sqlite(pool) => pool,
        #[allow(unreachable_patterns)]
        _ => return Err("Connexion SQLite attendue".into()),
    };

    // Vérifie l'appartenance au compte actif (cf. insurance.ts V1).
    let active: Option<String> =
        sqlx::query("SELECT value FROM AppMeta WHERE key = 'rsiAccount.activeId'")
            .fetch_optional(pool)
            .await
            .map_err(|e| e.to_string())?
            .and_then(|r| r.try_get::<String, _>("value").ok());
    let active = active.ok_or_else(|| "Aucun compte actif".to_string())?;

    let ship_account: Option<String> = sqlx::query("SELECT accountId FROM Ship WHERE id = ?")
        .bind(ship_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?
        .and_then(|r| r.try_get::<String, _>("accountId").ok());
    let ship_account = ship_account.ok_or_else(|| "Vaisseau introuvable".to_string())?;

    if ship_account != active {
        return Err("Vaisseau appartenant à un autre compte".into());
    }

    sqlx::query(
        "UPDATE Ship SET insuranceExpiry = ?, insuranceDuration = ?, updatedAt = datetime('now')
         WHERE id = ?",
    )
    .bind(new_expiry_iso.as_deref())
    .bind(insurance_duration)
    .bind(ship_id)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}
