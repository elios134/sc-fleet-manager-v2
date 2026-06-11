use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{Column, Row};
use std::collections::HashSet;
use tauri::State;
use tauri_plugin_sql::{DbInstances, DbPool};

const DB_URL: &str = "sqlite:scfleet.db";

#[derive(Serialize)]
#[allow(non_snake_case)]
pub struct NextExpiry {
    shipName: String,
    daysRemaining: i64,
}

#[derive(Serialize)]
#[allow(non_snake_case)]
pub struct FleetStats {
    totalFleetValueUsd: f64,
    shipsOwnedCount: i64,
    ltiAssetsCount: i64,
    nextExpiry: Option<NextExpiry>,
}

/* ───────────────────────  Helpers date (sans dépendance)  ─────────────────── */

/// Numéro de jour depuis 1970-01-01 (algorithme days_from_civil de H. Hinnant).
/// `m` ∈ [1,12], `d` ∈ [1,31]. Valeur monotone → diffs = nombres de jours.
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

fn is_leap(y: i64) -> bool {
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}

fn days_in_month(y: i64, m: i64) -> i64 {
    match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if is_leap(y) {
                29
            } else {
                28
            }
        }
        _ => 30,
    }
}

/// Nom de mois anglais (complet ou abrégé) → numéro [1,12].
fn month_to_num(s: &str) -> Option<i64> {
    match s.to_lowercase().get(..3)? {
        "jan" => Some(1),
        "feb" => Some(2),
        "mar" => Some(3),
        "apr" => Some(4),
        "may" => Some(5),
        "jun" => Some(6),
        "jul" => Some(7),
        "aug" => Some(8),
        "sep" => Some(9),
        "oct" => Some(10),
        "nov" => Some(11),
        "dec" => Some(12),
        _ => None,
    }
}

/// Parse une date « May 26, 2026 » (mois anglais ; format RSI /en/) → (année, mois, jour).
fn parse_created_date(raw: &str) -> Option<(i64, i64, i64)> {
    let cleaned = raw.replace(',', " ");
    let parts: Vec<&str> = cleaned.split_whitespace().collect();
    if parts.len() < 3 {
        return None;
    }
    let month = month_to_num(parts[0])?;
    let day = parts[1].parse::<i64>().ok()?;
    let year = parts[2].parse::<i64>().ok()?;
    if !(1..=31).contains(&day) {
        return None;
    }
    Some((year, month, day))
}

/// Jour courant (UTC) en nombre de jours depuis 1970-01-01.
fn today_days() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    secs / 86_400
}

/// Réplique V1 `computeNextExpiry` : expiry = createdDate + insuranceMonths mois ;
/// ignore LTI (months null) et déjà-expirés ; renvoie le plus proche. `pledges` =
/// (createdDate brut, insuranceMonths, nom du 1ᵉʳ vaisseau ou nom du pledge).
fn compute_next_expiry(
    pledges: &[(Option<String>, Option<i64>, String)],
) -> Option<NextExpiry> {
    let now = today_days();
    let mut best: Option<NextExpiry> = None;

    for (created, months, ship_name) in pledges {
        let (Some(created), Some(months)) = (created, months) else {
            continue;
        };
        let Some((y, m, d)) = parse_created_date(created) else {
            continue;
        };
        // Ajout de `months` mois (jour conservé, borné à la longueur du mois cible).
        let total = (m - 1) + months;
        let ey = y + total.div_euclid(12);
        let em = total.rem_euclid(12) + 1;
        let ed = d.min(days_in_month(ey, em));

        let days_remaining = days_from_civil(ey, em, ed) - now;
        if days_remaining <= 0 {
            continue;
        }
        if best.as_ref().map_or(true, |b| days_remaining < b.daysRemaining) {
            best = Some(NextExpiry {
                shipName: ship_name.clone(),
                daysRemaining: days_remaining,
            });
        }
    }
    best
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
          COALESCE(
            (SELECT ps.imageUrl FROM PledgeShip ps
             WHERE ps.shipId = s.id AND ps.imageUrl IS NOT NULL
             ORDER BY ps.id ASC LIMIT 1),
            sd.imageUrl
          ) AS imageUrl,
          sd.imageTopDownUrl, sd.role as shipDataRole,
          sd.manufacturer as shipDataManufacturer, sd.classification as shipDataClassification,
          sd.focus as shipDataFocus, sd.size as shipDataSize,
          sd.crewMin, sd.crewMax, sd.cargoScu, sd.mass,
          sd.length, sd.beam, sd.height, sd.scmSpeed, sd.maxSpeed,
          sd.shieldHp, sd.hullHp, sd.emSignature, sd.irSignature
        FROM Ship s
        LEFT JOIN ShipData sd ON sd.name = s.name
        WHERE s.accountId = ?
          -- Exclut les vaisseaux appartenant à un pledge multi-ships (>1 PledgeShip) :
          -- ils sont présentés via la section Packs, pas en cartes individuelles
          -- (réplique la logique V1 FleetPage : grille = pledges à 1 ship uniquement).
          AND s.id NOT IN (
            SELECT ps.shipId FROM PledgeShip ps
            WHERE ps.shipId IS NOT NULL
              AND ps.pledgeId IN (
                SELECT pledgeId FROM PledgeShip GROUP BY pledgeId HAVING COUNT(*) > 1
              )
          )
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

    // Prochaine expiration d'assurance (réplique V1 computeNextExpiry).
    // Récupère createdDate + insuranceMonths + nom du 1ᵉʳ vaisseau de chaque pledge.
    let exp_rows = sqlx::query(
        "SELECT p.createdDate AS createdDate, p.insuranceMonths AS insuranceMonths, p.name AS pledgeName,
                (SELECT ps.shipName FROM PledgeShip ps WHERE ps.pledgeId = p.id
                 ORDER BY ps.id ASC LIMIT 1) AS firstShipName
         FROM Pledge p
         WHERE p.accountId = ? AND p.insuranceMonths IS NOT NULL",
    )
    .bind(&account_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let exp_input: Vec<(Option<String>, Option<i64>, String)> = exp_rows
        .iter()
        .map(|r| {
            let created = r.try_get::<Option<String>, _>("createdDate").ok().flatten();
            let months = r.try_get::<Option<i64>, _>("insuranceMonths").ok().flatten();
            let first_ship = r.try_get::<Option<String>, _>("firstShipName").ok().flatten();
            let pledge_name = r.try_get::<String, _>("pledgeName").unwrap_or_default();
            (created, months, first_ship.unwrap_or(pledge_name))
        })
        .collect();
    let next_expiry = compute_next_expiry(&exp_input);

    Ok(FleetStats {
        totalFleetValueUsd: total_fleet_value_usd,
        shipsOwnedCount: ships_owned_count,
        ltiAssetsCount: lti_assets_count,
        nextExpiry: next_expiry,
    })
}

/* ─────────────────────  Sync RSI : scrape → DB (6b.2)  ────────────────────── */
//
// Réplique fidèlement la logique V1 `fleet:syncFromRsi` (handlers/fleet.ts) :
//   A — suppression des pledges « stale » (plus présents au scrape) + leurs ships liés
//   C — upsert Pledge, puis adopt-or-create Ship + création/maj PledgeShip,
//       puis persistance des HangarItem (items/cosmétiques) du pledge
//   B — ménage final des Ships orphelins importés (sans PledgeShip)
// Les HangarItem sont bien persistés (clear-then-recreate par pledge, dédup par title ;
// cf. plus bas). Écart assumé vs V1 : détection de devise omise (RsiAccount.currency
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

/// Item/cosmétique tel que renvoyé par `scrape_rsi_hangar` (JSON camelCase).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncItemInput {
    title: String,
    kind: Option<String>,
    image_url: Option<String>,
    manufacturer: Option<String>,
}

/// Pledge tel que renvoyé par `scrape_rsi_hangar` (JSON camelCase).
/// Les champs non utilisés ici (upgrades, pledgeImageUrl) sont ignorés.
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
    #[serde(default)]
    items: Vec<SyncItemInput>,
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

        // ── Items / cosmétiques (HangarItem) ─────────────────────────────────
        // Fidèle à V1 (clear-then-recreate par pledge, fleet.ts l.440) : dédup par
        // title trimé (titres vides ignorés, première occurrence gardée) pour
        // honorer l'unique (pledgeId, title) ; élagage des items absents du scrape ;
        // puis upsert de chacun (consigne 6b étape 2).
        let mut seen_titles: HashSet<String> = HashSet::new();
        let mut items_to_upsert: Vec<(&SyncItemInput, String)> = Vec::new();
        for it in &p.items {
            let title = it.title.trim().to_string();
            if title.is_empty() || !seen_titles.insert(title.clone()) {
                continue;
            }
            items_to_upsert.push((it, title));
        }

        // Élagage : supprime les HangarItem de ce pledge dont le title n'est plus scrapé.
        let existing_items = sqlx::query("SELECT id, title FROM HangarItem WHERE pledgeId = ?")
            .bind(pledge_id)
            .fetch_all(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        for r in existing_items {
            let hid: i64 = r.try_get("id").map_err(|e| e.to_string())?;
            let htitle: String = r.try_get("title").map_err(|e| e.to_string())?;
            if !seen_titles.contains(htitle.as_str()) {
                sqlx::query("DELETE FROM HangarItem WHERE id = ?")
                    .bind(hid)
                    .execute(&mut *tx)
                    .await
                    .map_err(|e| e.to_string())?;
            }
        }

        // Upsert de chaque item conservé (kind/imageUrl/manufacturer rafraîchis).
        for (it, title) in &items_to_upsert {
            sqlx::query(
                "INSERT INTO HangarItem
                   (pledgeId, accountId, title, kind, imageUrl, manufacturer, createdAt, updatedAt)
                 VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
                 ON CONFLICT(pledgeId, title) DO UPDATE SET
                   kind         = excluded.kind,
                   imageUrl     = excluded.imageUrl,
                   manufacturer = excluded.manufacturer,
                   updatedAt    = datetime('now')",
            )
            .bind(pledge_id)
            .bind(&account_id)
            .bind(title)
            .bind(it.kind.as_deref())
            .bind(it.image_url.as_deref())
            .bind(it.manufacturer.as_deref())
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
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

    // Nettoyage des HangarItem orphelins (pledge disparu). Déjà couvert par le
    // Step A, rendu explicite ici par sécurité.
    sqlx::query(
        "DELETE FROM HangarItem
         WHERE accountId = ?
           AND pledgeId NOT IN (SELECT id FROM Pledge WHERE accountId = ?)",
    )
    .bind(&account_id)
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

/// Items/cosmétiques du hangar pour un compte (alimente la future page Items & Cosmetics).
#[tauri::command]
pub async fn get_hangar_items(
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

    // pledgeName (JOIN Pledge) en plus du schéma de base : la page Items & Cosmetics
    // groupe les items par pledge et affiche son nom (titre du package + source).
    let rows = sqlx::query(
        "SELECT h.id, h.pledgeId, h.accountId, h.title, h.kind, h.imageUrl, h.manufacturer,
                p.name AS pledgeName
         FROM HangarItem h
         LEFT JOIN Pledge p ON p.id = h.pledgeId
         WHERE h.accountId = ?
         ORDER BY h.title ASC",
    )
    .bind(account_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows.iter().map(row_to_json).collect())
}

/// Origine pledge d'un vaisseau (pour la fiche détail My Fleet).
/// Lien Ship↔Pledge via PledgeShip (Ship.rsiPledgeId n'est pas peuplé par la sync).
/// Renvoie null si le vaisseau n'est rattaché à aucun pledge (ajout manuel).
#[tauri::command]
pub async fn get_ship_pledge_origin(
    ship_id: i64,
    db_instances: State<'_, DbInstances>,
) -> Result<Option<Value>, String> {
    let instances = db_instances.0.read().await;
    let db = instances
        .get(DB_URL)
        .ok_or_else(|| format!("Base de données non chargée : {DB_URL}"))?;

    let pool = match db {
        DbPool::Sqlite(pool) => pool,
        #[allow(unreachable_patterns)]
        _ => return Err("Connexion SQLite attendue".into()),
    };

    let row = sqlx::query(
        "SELECT p.id AS pledgeId, p.name AS pledgeName, p.type AS pledgeType,
                p.createdDate AS createdDate, p.isUpgraded AS isUpgraded,
                (SELECT COUNT(*) FROM PledgeShip ps2 WHERE ps2.pledgeId = p.id) AS shipsCount
         FROM PledgeShip ps
         JOIN Pledge p ON p.id = ps.pledgeId
         WHERE ps.shipId = ?
         LIMIT 1",
    )
    .bind(ship_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(row.as_ref().map(row_to_json))
}

/// Packs (pledges contenant > 1 vaisseau) d'un compte — alimente la section Packs
/// de My Fleet (cartes ouvrant la page Pack Detail).
#[tauri::command]
pub async fn get_fleet_packs(
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
        "SELECT p.id AS pledgeId, p.name AS pledgeName, p.type AS pledgeType,
                p.createdDate AS createdDate, p.currentValueUsd AS currentValueUsd,
                p.lti AS lti, COUNT(ps.id) AS shipsCount
         FROM Pledge p
         JOIN PledgeShip ps ON ps.pledgeId = p.id
         WHERE p.accountId = ?
         GROUP BY p.id
         HAVING COUNT(ps.id) > 1
         ORDER BY p.name ASC",
    )
    .bind(account_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows.iter().map(row_to_json).collect())
}

/// Détail d'un pack (pledge) : en-tête + compteurs dérivés + liste des vaisseaux.
/// Les valeurs UEC / specs dépendent de ShipData (datamining, Bloc C) et sont omises.
#[tauri::command]
pub async fn get_pack_detail(
    pledge_id: i64,
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

    let pledge = sqlx::query(
        "SELECT id, name, type, createdDate, currentValueUsd, isUpgraded, lti
         FROM Pledge WHERE id = ?",
    )
    .bind(pledge_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| format!("Pack introuvable : {pledge_id}"))?;

    let pledge_lti: i64 = pledge
        .try_get::<Option<i64>, _>("lti")
        .ok()
        .flatten()
        .unwrap_or(0);

    // Vaisseaux du pack (image RSI via PledgeShip ; Ship pour id/role/lti/assurance).
    let ship_rows = sqlx::query(
        "SELECT ps.shipName, ps.manufacturer, ps.imageUrl,
                s.id AS shipId, s.role, s.lti, s.insuranceDuration, s.insuranceExpiry
         FROM PledgeShip ps
         LEFT JOIN Ship s ON s.id = ps.shipId
         WHERE ps.pledgeId = ?
         ORDER BY ps.shipName ASC",
    )
    .bind(pledge_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    // Compteurs dérivés.
    let mut manufacturers: HashSet<String> = HashSet::new();
    let mut lti_ships_count: i64 = 0;
    for r in &ship_rows {
        let manu: String = r.try_get("manufacturer").unwrap_or_default();
        if !manu.trim().is_empty() {
            manufacturers.insert(manu);
        }
        let ship_lti: Option<i64> = r.try_get::<Option<i64>, _>("lti").ok().flatten();
        if ship_lti.unwrap_or(pledge_lti) == 1 {
            lti_ships_count += 1;
        }
    }

    let ships: Vec<Value> = ship_rows.iter().map(row_to_json).collect();

    Ok(json!({
        "pledgeId":           pledge.try_get::<i64, _>("id").map_err(|e| e.to_string())?,
        "pledgeName":         pledge.try_get::<String, _>("name").map_err(|e| e.to_string())?,
        "pledgeType":         pledge.try_get::<String, _>("type").map_err(|e| e.to_string())?,
        "createdDate":        pledge.try_get::<Option<String>, _>("createdDate").ok().flatten(),
        "currentValueUsd":    pledge.try_get::<Option<f64>, _>("currentValueUsd").ok().flatten(),
        "isUpgraded":         pledge.try_get::<Option<i64>, _>("isUpgraded").ok().flatten().unwrap_or(0),
        "shipsCount":         ship_rows.len() as i64,
        "ltiShipsCount":      lti_ships_count,
        "manufacturersCount": manufacturers.len() as i64,
        "ships":              ships,
    }))
}
