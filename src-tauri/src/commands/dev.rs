use sqlx::Row;
use tauri::State;
use tauri_plugin_sql::{DbInstances, DbPool};

use crate::DB_URL;

// Identifiant factice reconnaissable du pack de test (cf. consigne étape 5.5).
const SAMPLE_RSI_PLEDGE_ID: &str = "TEST_PACK_001";

// Sous-ensemble fidèle du « Praetorian Pack » V1 (fixture praetorian-pack.html) :
// pack LTI, fabricants variés, > 10 vaisseaux (exerce le load-more de Pack Detail).
const SAMPLE_SHIPS: &[(&str, &str)] = &[
    ("400i", "Origin Jumpworks"),
    ("890 JUMP", "Origin Jumpworks"),
    ("Cyclone AA", "Tumbril"),
    ("F8C Lightning", "Anvil Aerospace"),
    ("Hull E", "MISC"),
    ("Idris-M Frigate", "Aegis Dynamics"),
    ("Ironclad Assault", "Drake Interplanetary"),
    ("Javelin", "Aegis Dynamics"),
    ("Kraken Privateer", "Drake Interplanetary"),
    ("Hercules Starlifter M2", "Crusader Industries"),
    ("Merchantman", "Banu"),
    ("MTC", "Greycat Industrial"),
    ("Nova Tank", "Tumbril"),
    ("Perseus", "Roberts Space Industries"),
];

/// Insère un faux pack multi-ships (game_package, LTI) pour tester Pack Detail.
/// Réplique la logique du seed V1 (diagnostic.ts dev:seedSamplePledge) : upsert
/// Pledge, puis adopt-or-create des Ship + création des PledgeShip. Idempotent.
#[tauri::command]
pub async fn seed_sample_pack(
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

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    // Upsert du Pledge (conflit sur l'index unique accountId+rsiPledgeId).
    let pledge_row = sqlx::query(
        "INSERT INTO Pledge
           (rsiPledgeId, accountId, name, type, currentValueUsd, currency,
            isUpgraded, isBuybackable, createdDate, lti, insuranceMonths,
            createdAt, updatedAt)
         VALUES (?, ?, ?, 'game_package', 15710.0, 'USD', 0, 1, ?, 1, NULL,
                 datetime('now'), datetime('now'))
         ON CONFLICT(accountId, rsiPledgeId) DO UPDATE SET
           name            = excluded.name,
           currentValueUsd = excluded.currentValueUsd,
           updatedAt       = datetime('now')
         RETURNING id",
    )
    .bind(SAMPLE_RSI_PLEDGE_ID)
    .bind(&account_id)
    .bind("Package - Praetorian Pack (TEST)")
    .bind("2024-01-01")
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;
    let pledge_id: i64 = pledge_row.try_get("id").map_err(|e| e.to_string())?;

    for (ship_name, manufacturer) in SAMPLE_SHIPS {
        let existing =
            sqlx::query("SELECT id FROM PledgeShip WHERE pledgeId = ? AND shipName = ?")
                .bind(pledge_id)
                .bind(ship_name)
                .fetch_optional(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
        if existing.is_some() {
            continue; // idempotent : déjà présent
        }

        // Adopt-or-create (même logique que sync_fleet_from_scrape).
        let orphan = sqlx::query(
            "SELECT id FROM Ship
             WHERE accountId = ? AND name = ? AND importedFromRsi = 1
               AND id NOT IN (SELECT shipId FROM PledgeShip WHERE shipId IS NOT NULL)
             ORDER BY createdAt ASC LIMIT 1",
        )
        .bind(&account_id)
        .bind(ship_name)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

        let ship_id: i64 = match orphan {
            Some(o) => {
                let oid: i64 = o.try_get("id").map_err(|e| e.to_string())?;
                sqlx::query("UPDATE Ship SET lti = 1, rsiSyncedAt = datetime('now') WHERE id = ?")
                    .bind(oid)
                    .execute(&mut *tx)
                    .await
                    .map_err(|e| e.to_string())?;
                oid
            }
            None => {
                let new_row = sqlx::query(
                    "INSERT INTO Ship
                       (name, manufacturer, role, lti, importedFromRsi, rsiSyncedAt,
                        accountId, createdAt, updatedAt)
                     VALUES (?, ?, 'MULTI', 1, 1, datetime('now'), ?,
                             datetime('now'), datetime('now'))
                     RETURNING id",
                )
                .bind(ship_name)
                .bind(manufacturer)
                .bind(&account_id)
                .fetch_one(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
                new_row.try_get("id").map_err(|e| e.to_string())?
            }
        };

        sqlx::query(
            "INSERT INTO PledgeShip
               (pledgeId, shipName, manufacturer, isNameable, shipId, createdAt, updatedAt)
             VALUES (?, ?, ?, 0, ?, datetime('now'), datetime('now'))",
        )
        .bind(pledge_id)
        .bind(ship_name)
        .bind(manufacturer)
        .bind(ship_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    }

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}

/// Supprime le pack de test (rsiPledgeId = TEST_PACK_001) + ses PledgeShip et Ship liés.
/// Réplique la suppression « stale » de sync_fleet_from_scrape.
#[tauri::command]
pub async fn remove_sample_pack(
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

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    let pledge = sqlx::query("SELECT id FROM Pledge WHERE accountId = ? AND rsiPledgeId = ?")
        .bind(&account_id)
        .bind(SAMPLE_RSI_PLEDGE_ID)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    let Some(pledge) = pledge else {
        // Rien à supprimer.
        tx.commit().await.map_err(|e| e.to_string())?;
        return Ok(());
    };
    let pledge_id: i64 = pledge.try_get("id").map_err(|e| e.to_string())?;

    // Ships liés (récupérés avant suppression des PledgeShip).
    let ship_rows = sqlx::query("SELECT shipId FROM PledgeShip WHERE pledgeId = ? AND shipId IS NOT NULL")
        .bind(pledge_id)
        .fetch_all(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    // Suppressions enfants explicites (pas de cascade garanti), puis le pledge, puis les ships.
    sqlx::query("DELETE FROM PledgeShip WHERE pledgeId = ?")
        .bind(pledge_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM Pledge WHERE id = ?")
        .bind(pledge_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    for r in ship_rows {
        let sid: i64 = r.try_get("shipId").map_err(|e| e.to_string())?;
        sqlx::query("DELETE FROM Ship WHERE id = ?")
            .bind(sid)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    }

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}
