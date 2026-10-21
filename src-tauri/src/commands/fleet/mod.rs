use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{Column, Row};
use std::collections::HashSet;
use tauri::State;
use tauri_plugin_sql::{DbInstances, DbPool};

use crate::DB_URL;

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
          s.acquisition, s.shipDataId, s.rentalExpiresAt, s.rentalDurationDays,
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
          sd.shieldHp, sd.hullHp, sd.emSignature, sd.irSignature, sd.baseDps,
          -- Prix / flags depuis le pledge d'origine (1 seul PledgeShip : grille = pledges 1-ship).
          (SELECT pp.currentValueUsd FROM PledgeShip pps JOIN Pledge pp ON pp.id = pps.pledgeId
             WHERE pps.shipId = s.id ORDER BY pps.id ASC LIMIT 1) AS currentValueUsd,
          (SELECT pp.isUpgraded FROM PledgeShip pps JOIN Pledge pp ON pp.id = pps.pledgeId
             WHERE pps.shipId = s.id ORDER BY pps.id ASC LIMIT 1) AS isUpgraded,
          (SELECT pp.isBuybackable FROM PledgeShip pps JOIN Pledge pp ON pp.id = pps.pledgeId
             WHERE pps.shipId = s.id ORDER BY pps.id ASC LIMIT 1) AS isBuybackable
        FROM Ship s
        -- Jointure ShipData par nom, avec :
        --  • alias de noms divergents (variante absente du catalogue ; ex. « Dragonfly Black »
        --    n'existe pas en ShipData, mappé sur « Dragonfly ») — table extensible ci-dessous ;
        --  • UNE seule ligne par vaisseau (ShipData a des doublons de noms, ex. « Cutlass Black »
        --    ×2) : on prend le plus petit id → pas de carte dupliquée.
        LEFT JOIN ShipData sd ON sd.id = (
          SELECT sd2.id FROM ShipData sd2
          WHERE sd2.name = CASE s.name
            WHEN 'Dragonfly Black' THEN 'Dragonfly'
            ELSE s.name
          END
          ORDER BY sd2.id ASC LIMIT 1
        )
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

/// Détail d'un pack (pledge) : en-tête + compteurs dérivés + liste des vaisseaux.
/// Les valeurs UEC / specs dépendent de ShipData (datamining, Bloc C) et sont omises.
#[allow(unreachable_patterns)]
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

// Sous-modules (déclarés après les macros locales, visibles par portée textuelle).
mod dates;
pub(crate) use dates::*;
pub(crate) mod sync;
pub(crate) mod acquisition;
