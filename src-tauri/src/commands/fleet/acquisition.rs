// Acquisition de vaisseaux en jeu (achat / location) : ajout, suppression, prolongation.
use super::*;

/* ─────────────────── Acquisition vaisseaux (acheter / louer) ─────────────────── */

// Pool SQLite (réplique du pattern de get_ships).
macro_rules! fleet_pool {
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

/// Ajoute un vaisseau à la flotte du compte actif depuis le catalogue (ShipData).
/// mode = "bought" (acheté in-game, loadout modifiable) | "rented" (loué, loadout
/// figé, expiration = now + rental_days). role='MULTI' (comme la sync RSI).
#[tauri::command]
pub async fn add_fleet_ship(
    account_id: String,
    ship_data_id: i64,
    mode: String,
    rental_days: Option<i64>,
    db_instances: State<'_, DbInstances>,
) -> Result<i64, String> {
    if account_id.trim().is_empty() {
        return Err("Aucun compte actif.".into());
    }
    let acquisition = match mode.as_str() {
        "bought" | "rented" => mode.as_str(),
        _ => return Err("Mode invalide (attendu : bought | rented).".into()),
    };

    let instances = db_instances.0.read().await;
    let pool = fleet_pool!(instances);

    // Nom / constructeur depuis le catalogue.
    let cat = sqlx::query("SELECT name, manufacturer FROM ShipData WHERE id = ?")
        .bind(ship_data_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Vaisseau catalogue introuvable.".to_string())?;
    let name: String = cat.try_get("name").map_err(|e| e.to_string())?;
    let manufacturer: String = cat.try_get("manufacturer").map_err(|e| e.to_string())?;

    let id = if acquisition == "rented" {
        let days = rental_days
            .filter(|d| *d > 0)
            .ok_or_else(|| "Durée de location requise (> 0).".to_string())?;
        let modifier = format!("+{days} days");
        sqlx::query(
            "INSERT INTO Ship
               (name, manufacturer, role, accountId, acquisition, shipDataId, importedFromRsi,
                rentalDurationDays, rentalExpiresAt, createdAt, updatedAt)
             VALUES (?, ?, 'MULTI', ?, 'rented', ?, 0, ?, datetime('now', ?),
                     datetime('now'), datetime('now'))
             RETURNING id",
        )
        .bind(&name)
        .bind(&manufacturer)
        .bind(&account_id)
        .bind(ship_data_id)
        .bind(days)
        .bind(&modifier)
        .fetch_one(pool)
        .await
    } else {
        sqlx::query(
            "INSERT INTO Ship
               (name, manufacturer, role, accountId, acquisition, shipDataId, importedFromRsi,
                createdAt, updatedAt)
             VALUES (?, ?, 'MULTI', ?, 'bought', ?, 0, datetime('now'), datetime('now'))
             RETURNING id",
        )
        .bind(&name)
        .bind(&manufacturer)
        .bind(&account_id)
        .bind(ship_data_id)
        .fetch_one(pool)
        .await
    }
    .map_err(|e| e.to_string())?
    .try_get::<i64, _>("id")
    .map_err(|e| e.to_string())?;

    Ok(id)
}

/// Supprime manuellement un vaisseau de la flotte (cascade Loadout). L'UI ne propose
/// la suppression que pour les vaisseaux ajoutés (bought/rented) ; les RSI restent
/// gérés par la sync.
#[tauri::command]
pub async fn delete_fleet_ship(
    ship_id: i64,
    db_instances: State<'_, DbInstances>,
) -> Result<(), String> {
    let instances = db_instances.0.read().await;
    let pool = fleet_pool!(instances);
    sqlx::query("DELETE FROM Ship WHERE id = ?")
        .bind(ship_id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Prolonge la location : nouvelle expiration = max(expiration actuelle, maintenant)
/// + add_days. Repart donc de « maintenant » si déjà expiré, sinon prolonge la fin.
/// Renvoie la nouvelle date d'expiration. No-op si le vaisseau n'est pas loué.
#[tauri::command]
pub async fn extend_ship_rental(
    ship_id: i64,
    add_days: i64,
    db_instances: State<'_, DbInstances>,
) -> Result<Option<String>, String> {
    if add_days <= 0 {
        return Err("Nombre de jours invalide (> 0).".into());
    }
    let instances = db_instances.0.read().await;
    let pool = fleet_pool!(instances);
    let modifier = format!("+{add_days} days");
    sqlx::query(
        "UPDATE Ship
           SET rentalExpiresAt =
                 datetime(MAX(COALESCE(rentalExpiresAt, datetime('now')), datetime('now')), ?),
               updatedAt = datetime('now')
         WHERE id = ? AND acquisition = 'rented'",
    )
    .bind(&modifier)
    .bind(ship_id)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    let expiry = sqlx::query("SELECT rentalExpiresAt FROM Ship WHERE id = ?")
        .bind(ship_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?
        .and_then(|r| r.try_get::<Option<String>, _>("rentalExpiresAt").ok().flatten());
    Ok(expiry)
}
