use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{Column, Row};
use std::collections::HashSet;
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

/* ─────────────────────  Sync RSI : scrape → DB (6b.2)  ────────────────────── */
//
// Réplique fidèlement la logique V1 `fleet:syncFromRsi` (handlers/fleet.ts) :
//   A — suppression des pledges « stale » (plus présents au scrape) + leurs ships liés
//   C — upsert Pledge, puis adopt-or-create Ship + création/maj PledgeShip
//   B — ménage final des Ships orphelins importés (sans PledgeShip)
// Écarts assumés vs V1 (cf. rapport 6b.2) : HangarItem et PledgeUpgradeLog différés
// (Bloc A step 2 / étape ultérieure) ; détection de devise omise (RsiAccount.currency
// n'existe pas dans le schéma V2). Les suppressions enfants sont explicites car le
// PRAGMA foreign_keys n'est pas garanti activé par tauri_plugin_sql.

/// Navire tel que renvoyé par `scrape_rsi_hangar` (JSON camelCase).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncShipInput {
    ship_name: String,
    manufacturer: String,
    manufacturer_code: Option<String>,
    image_url: Option<String>,
    membership_id: Option<String>,
    custom_name: Option<String>,
    is_nameable: bool,
}

/// Pledge tel que renvoyé par `scrape_rsi_hangar` (JSON camelCase).
/// Les champs non utilisés ici (items, upgrades, pledgeImageUrl) sont ignorés.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncPledgeInput {
    rsi_pledge_id: String,
    name: String,
    pledge_type: String,
    current_value_usd: Option<f64>,
    currency: Option<String>,
    is_upgraded: bool,
    is_buybackable: bool,
    created_date: Option<String>,
    lti: bool,
    insurance_months: Option<i64>,
    ships: Vec<SyncShipInput>,
}

#[derive(Serialize)]
#[allow(non_snake_case)]
pub struct SyncResult {
    imported: i64,
    adopted: i64,
    deleted: i64,
}

#[tauri::command]
pub async fn sync_fleet_from_scrape(
    handle: String,
    pledges: Vec<SyncPledgeInput>,
    db_instances: State<'_, DbInstances>,
) -> Result<SyncResult, String> {
    // Garde-fou : un scrape vide ne doit jamais vider toute la flotte.
    if pledges.is_empty() {
        return Err("La liste des pledges est vide — synchronisation annulée".into());
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

    // handle → accountId (id entier stocké en TEXT, cf. account.rs / get_ships).
    let acc_row = sqlx::query("SELECT id FROM RsiAccount WHERE handle = ?")
        .bind(&handle)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Compte introuvable : {handle}"))?;
    let account_id_int: i64 = acc_row.try_get("id").map_err(|e| e.to_string())?;
    let account_id = account_id_int.to_string();

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    // ── Step A — suppression des pledges stale + ships liés ──────────────────
    let scraped_ids: HashSet<&str> = pledges.iter().map(|p| p.rsi_pledge_id.as_str()).collect();
    let existing_pledges = sqlx::query("SELECT id, rsiPledgeId FROM Pledge WHERE accountId = ?")
        .bind(&account_id)
        .fetch_all(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    let mut deleted: i64 = 0;
    for row in &existing_pledges {
        let pid: i64 = row.try_get("id").map_err(|e| e.to_string())?;
        let rsi_id: String = row.try_get("rsiPledgeId").map_err(|e| e.to_string())?;
        if scraped_ids.contains(rsi_id.as_str()) {
            continue;
        }
        // Ships liés à supprimer (récupérés avant suppression des PledgeShip).
        let ship_rows = sqlx::query(
            "SELECT shipId FROM PledgeShip WHERE pledgeId = ? AND shipId IS NOT NULL",
        )
        .bind(pid)
        .fetch_all(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

        // Suppressions enfants explicites (pas de cascade garanti), puis le pledge.
        sqlx::query("DELETE FROM HangarItem WHERE pledgeId = ?")
            .bind(pid)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        sqlx::query("DELETE FROM PledgeUpgradeLog WHERE pledgeId = ?")
            .bind(pid)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        sqlx::query("DELETE FROM PledgeShip WHERE pledgeId = ?")
            .bind(pid)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        sqlx::query("DELETE FROM Pledge WHERE id = ?")
            .bind(pid)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        for sr in ship_rows {
            let sid: i64 = sr.try_get("shipId").map_err(|e| e.to_string())?;
            sqlx::query("DELETE FROM Ship WHERE id = ?")
                .bind(sid)
                .execute(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
        }
        deleted += 1;
    }

    // ── Step C — upsert Pledge + adopt-or-create Ship + PledgeShip ───────────
    let mut imported: i64 = 0;
    let mut adopted: i64 = 0;

    for p in &pledges {
        // Upsert Pledge (conflit sur l'index unique accountId+rsiPledgeId).
        // À la mise à jour, on ne touche ni `type` ni `createdDate` (fidèle à V1).
        let pledge_row = sqlx::query(
            "INSERT INTO Pledge
               (rsiPledgeId, accountId, name, type, currentValueUsd, currency,
                isUpgraded, isBuybackable, createdDate, lti, insuranceMonths,
                createdAt, updatedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                     datetime('now'),
                     datetime('now'))
             ON CONFLICT(accountId, rsiPledgeId) DO UPDATE SET
               name            = excluded.name,
               currentValueUsd = excluded.currentValueUsd,
               currency        = excluded.currency,
               isUpgraded      = excluded.isUpgraded,
               isBuybackable   = excluded.isBuybackable,
               lti             = excluded.lti,
               insuranceMonths = excluded.insuranceMonths,
               updatedAt       = datetime('now')
             RETURNING id",
        )
        .bind(&p.rsi_pledge_id)
        .bind(&account_id)
        .bind(&p.name)
        .bind(&p.pledge_type)
        .bind(p.current_value_usd)
        .bind(p.currency.as_deref())
        .bind(p.is_upgraded)
        .bind(p.is_buybackable)
        .bind(p.created_date.as_deref())
        .bind(p.lti)
        .bind(p.insurance_months)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        let pledge_id: i64 = pledge_row.try_get("id").map_err(|e| e.to_string())?;

        // Suppression des PledgeShip stale de ce pledge (vaisseau retiré via CCU).
        let current_names: HashSet<&str> =
            p.ships.iter().map(|s| s.ship_name.as_str()).collect();
        let ps_rows = sqlx::query("SELECT id, shipId, shipName FROM PledgeShip WHERE pledgeId = ?")
            .bind(pledge_id)
            .fetch_all(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        for r in ps_rows {
            let psid: i64 = r.try_get("id").map_err(|e| e.to_string())?;
            let sname: String = r.try_get("shipName").map_err(|e| e.to_string())?;
            if current_names.contains(sname.as_str()) {
                continue;
            }
            let sid: Option<i64> = r.try_get::<Option<i64>, _>("shipId").ok().flatten();
            sqlx::query("DELETE FROM PledgeShip WHERE id = ?")
                .bind(psid)
                .execute(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
            if let Some(sid) = sid {
                sqlx::query("DELETE FROM Ship WHERE id = ?")
                    .bind(sid)
                    .execute(&mut *tx)
                    .await
                    .map_err(|e| e.to_string())?;
            }
        }

        // Upsert chaque PledgeShip + Ship lié.
        for ship in &p.ships {
            let existing =
                sqlx::query("SELECT id, shipId FROM PledgeShip WHERE pledgeId = ? AND shipName = ?")
                    .bind(pledge_id)
                    .bind(&ship.ship_name)
                    .fetch_optional(&mut *tx)
                    .await
                    .map_err(|e| e.to_string())?;

            match existing {
                None => {
                    // Adopt-or-create : réutilise un Ship orphelin (importé, sans PledgeShip)
                    // de même nom avant d'en créer un nouveau — préserve ses Loadouts.
                    let orphan = sqlx::query(
                        "SELECT id, insuranceDuration FROM Ship
                         WHERE accountId = ? AND name = ? AND importedFromRsi = 1
                           AND id NOT IN (SELECT shipId FROM PledgeShip WHERE shipId IS NOT NULL)
                         ORDER BY createdAt ASC LIMIT 1",
                    )
                    .bind(&account_id)
                    .bind(&ship.ship_name)
                    .fetch_optional(&mut *tx)
                    .await
                    .map_err(|e| e.to_string())?;

                    let ship_id: i64 = match orphan {
                        Some(o) => {
                            let oid: i64 = o.try_get("id").map_err(|e| e.to_string())?;
                            let cur_dur: Option<i64> =
                                o.try_get::<Option<i64>, _>("insuranceDuration").ok().flatten();
                            // Backfill insuranceDuration seulement si null (préserve un réglage user).
                            if cur_dur.is_none() && p.insurance_months.is_some() {
                                sqlx::query(
                                    "UPDATE Ship SET lti = ?, rsiSyncedAt = datetime('now'), insuranceDuration = ? WHERE id = ?",
                                )
                                .bind(p.lti)
                                .bind(p.insurance_months)
                                .bind(oid)
                                .execute(&mut *tx)
                                .await
                                .map_err(|e| e.to_string())?;
                            } else {
                                sqlx::query(
                                    "UPDATE Ship SET lti = ?, rsiSyncedAt = datetime('now') WHERE id = ?",
                                )
                                .bind(p.lti)
                                .bind(oid)
                                .execute(&mut *tx)
                                .await
                                .map_err(|e| e.to_string())?;
                            }
                            adopted += 1;
                            oid
                        }
                        None => {
                            let new_row = sqlx::query(
                                "INSERT INTO Ship
                                   (name, manufacturer, role, lti, insuranceDuration,
                                    importedFromRsi, rsiSyncedAt, accountId, createdAt, updatedAt)
                                 VALUES (?, ?, 'MULTI', ?, ?, 1,
                                         datetime('now'), ?,
                                         datetime('now'),
                                         datetime('now'))
                                 RETURNING id",
                            )
                            .bind(&ship.ship_name)
                            .bind(&ship.manufacturer)
                            .bind(p.lti)
                            .bind(p.insurance_months)
                            .bind(&account_id)
                            .fetch_one(&mut *tx)
                            .await
                            .map_err(|e| e.to_string())?;
                            imported += 1;
                            new_row.try_get("id").map_err(|e| e.to_string())?
                        }
                    };

                    sqlx::query(
                        "INSERT INTO PledgeShip
                           (pledgeId, shipName, manufacturer, manufacturerCode, imageUrl,
                            membershipId, customName, isNameable, shipId, createdAt, updatedAt)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?,
                                 datetime('now'),
                                 datetime('now'))",
                    )
                    .bind(pledge_id)
                    .bind(&ship.ship_name)
                    .bind(&ship.manufacturer)
                    .bind(ship.manufacturer_code.as_deref())
                    .bind(ship.image_url.as_deref())
                    .bind(ship.membership_id.as_deref())
                    .bind(ship.custom_name.as_deref())
                    .bind(ship.is_nameable)
                    .bind(ship_id)
                    .execute(&mut *tx)
                    .await
                    .map_err(|e| e.to_string())?;
                }
                Some(ex) => {
                    let exid: i64 = ex.try_get("id").map_err(|e| e.to_string())?;
                    let exshipid: Option<i64> =
                        ex.try_get::<Option<i64>, _>("shipId").ok().flatten();

                    sqlx::query(
                        "UPDATE PledgeShip SET
                           manufacturer = ?, manufacturerCode = ?, imageUrl = ?,
                           membershipId = ?, customName = ?, isNameable = ?,
                           updatedAt = datetime('now')
                         WHERE id = ?",
                    )
                    .bind(&ship.manufacturer)
                    .bind(ship.manufacturer_code.as_deref())
                    .bind(ship.image_url.as_deref())
                    .bind(ship.membership_id.as_deref())
                    .bind(ship.custom_name.as_deref())
                    .bind(ship.is_nameable)
                    .bind(exid)
                    .execute(&mut *tx)
                    .await
                    .map_err(|e| e.to_string())?;

                    if let Some(sid) = exshipid {
                        let cur = sqlx::query("SELECT insuranceDuration FROM Ship WHERE id = ?")
                            .bind(sid)
                            .fetch_optional(&mut *tx)
                            .await
                            .map_err(|e| e.to_string())?;
                        let cur_dur: Option<i64> = cur
                            .and_then(|r| r.try_get::<Option<i64>, _>("insuranceDuration").ok())
                            .flatten();
                        if cur_dur.is_none() && p.insurance_months.is_some() {
                            sqlx::query(
                                "UPDATE Ship SET lti = ?, rsiSyncedAt = datetime('now'), insuranceDuration = ? WHERE id = ?",
                            )
                            .bind(p.lti)
                            .bind(p.insurance_months)
                            .bind(sid)
                            .execute(&mut *tx)
                            .await
                            .map_err(|e| e.to_string())?;
                        } else {
                            sqlx::query(
                                "UPDATE Ship SET lti = ?, rsiSyncedAt = datetime('now') WHERE id = ?",
                            )
                            .bind(p.lti)
                            .bind(sid)
                            .execute(&mut *tx)
                            .await
                            .map_err(|e| e.to_string())?;
                        }
                    }
                }
            }
        }
    }

    // ── Step B — ménage final des Ships orphelins importés ───────────────────
    sqlx::query(
        "DELETE FROM Ship
         WHERE accountId = ? AND importedFromRsi = 1
           AND id NOT IN (SELECT shipId FROM PledgeShip WHERE shipId IS NOT NULL)",
    )
    .bind(&account_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    // Horodatage de dernière sync (lu par le Dashboard : AppMeta 'rsi.lastSyncedAt').
    sqlx::query(
        "INSERT OR REPLACE INTO AppMeta (key, value)
         VALUES ('rsi.lastSyncedAt', datetime('now'))",
    )
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())?;

    Ok(SyncResult {
        imported,
        adopted,
        deleted,
    })
}
