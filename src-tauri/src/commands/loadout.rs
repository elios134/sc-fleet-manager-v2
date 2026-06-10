use serde_json::{json, Value};
use sqlx::{Column, Row};
use std::collections::HashMap;
use tauri::State;
use tauri_plugin_sql::{DbInstances, DbPool};

const DB_URL: &str = "sqlite:scfleet.db";

macro_rules! sqlite_pool {
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

fn val_str(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(|x| x.as_str()).map(|s| s.to_string())
}

fn val_i64(v: &Value, key: &str) -> Option<i64> {
    v.get(key).and_then(|x| x.as_i64())
}

/* ─────────────────────── get_fleet_ships_for_loadout ─────────────────────── */

#[tauri::command]
pub async fn get_fleet_ships_for_loadout(
    account_id: String,
    db_instances: State<'_, DbInstances>,
) -> Result<Vec<Value>, String> {
    let instances = db_instances.0.read().await;
    let pool = sqlite_pool!(instances);

    let rows = sqlx::query(
        "SELECT s.id, s.name, s.manufacturer,
                sd.id as shipDataId, sd.wikiId, sd.imageUrl, sd.imageTopDownUrl
         FROM Ship s
         LEFT JOIN ShipData sd ON sd.name = s.name
         WHERE s.accountId = ?
         ORDER BY s.name ASC",
    )
    .bind(&account_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows.iter().map(row_to_json).collect())
}

/* ─────────────────────────── get_loadouts_by_ship ────────────────────────── */

struct CompStats {
    dps: Option<f64>,
    shield_hp: Option<f64>,
    power_draw: Option<f64>,
    alpha_damage: Option<f64>,
    shield_regen_rate: Option<f64>,
    power_output: Option<f64>,
}

#[tauri::command]
#[allow(unused_variables)]
pub async fn get_loadouts_by_ship(
    ship_id: i64,
    account_id: String,
    db_instances: State<'_, DbInstances>,
) -> Result<Vec<Value>, String> {
    let instances = db_instances.0.read().await;
    let pool = sqlite_pool!(instances);

    // Requête 1 — profils du vaisseau.
    let loadout_rows = sqlx::query(
        "SELECT id, shipId, profileName, createdAt, updatedAt
         FROM Loadout WHERE shipId = ? ORDER BY updatedAt DESC",
    )
    .bind(ship_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    // Requête 2 — tous les slots de tous les profils du vaisseau.
    let slot_rows = sqlx::query(
        "SELECT ls.id, ls.loadoutId, ls.slotType, ls.slotSize, ls.componentName,
                ls.componentGrade, ls.componentMake, ls.portName, ls.componentClassName
         FROM LoadoutSlot ls
         JOIN Loadout l ON l.id = ls.loadoutId
         WHERE l.shipId = ?",
    )
    .bind(ship_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    // Requête 3 — stats des composants référencés (enrichissement).
    let class_names: Vec<String> = slot_rows
        .iter()
        .filter_map(|r| r.try_get::<Option<String>, _>("componentClassName").ok().flatten())
        .filter(|s| !s.is_empty())
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();

    let mut stats_by_class: HashMap<String, CompStats> = HashMap::new();
    if !class_names.is_empty() {
        let placeholders = vec!["?"; class_names.len()].join(", ");
        let sql = format!(
            "SELECT className, name, type, dps, shieldHp, powerDraw, alphaDamage,
                    shieldRegenRate, powerOutput, qtDriveSpeed
             FROM Component WHERE className IN ({placeholders})"
        );
        let mut q = sqlx::query(&sql);
        for cn in &class_names {
            q = q.bind(cn);
        }
        let comp_rows = q.fetch_all(pool).await.map_err(|e| e.to_string())?;
        for r in &comp_rows {
            if let Ok(cn) = r.try_get::<String, _>("className") {
                stats_by_class.insert(
                    cn,
                    CompStats {
                        dps: r.try_get::<Option<f64>, _>("dps").ok().flatten(),
                        shield_hp: r.try_get::<Option<f64>, _>("shieldHp").ok().flatten(),
                        power_draw: r.try_get::<Option<f64>, _>("powerDraw").ok().flatten(),
                        alpha_damage: r.try_get::<Option<f64>, _>("alphaDamage").ok().flatten(),
                        shield_regen_rate: r
                            .try_get::<Option<f64>, _>("shieldRegenRate")
                            .ok()
                            .flatten(),
                        power_output: r.try_get::<Option<f64>, _>("powerOutput").ok().flatten(),
                    },
                );
            }
        }
    }

    // Slots enrichis, groupés par loadoutId.
    let mut slots_by_loadout: HashMap<i64, Vec<Value>> = HashMap::new();
    for r in &slot_rows {
        let loadout_id = r.try_get::<i64, _>("loadoutId").map_err(|e| e.to_string())?;
        let class_name = r.try_get::<Option<String>, _>("componentClassName").ok().flatten();
        let stats = class_name.as_ref().and_then(|cn| stats_by_class.get(cn));

        slots_by_loadout.entry(loadout_id).or_default().push(json!({
            "id": r.try_get::<i64, _>("id").ok(),
            "loadoutId": loadout_id,
            "slotType": r.try_get::<Option<String>, _>("slotType").ok().flatten(),
            "slotSize": r.try_get::<Option<i64>, _>("slotSize").ok().flatten(),
            "componentName": r.try_get::<Option<String>, _>("componentName").ok().flatten(),
            "componentGrade": r.try_get::<Option<String>, _>("componentGrade").ok().flatten(),
            "componentMake": r.try_get::<Option<String>, _>("componentMake").ok().flatten(),
            "portName": r.try_get::<Option<String>, _>("portName").ok().flatten(),
            "componentClassName": class_name,
            "realDps": stats.and_then(|s| s.dps),
            "realShieldHp": stats.and_then(|s| s.shield_hp),
            "realPowerDraw": stats.and_then(|s| s.power_draw),
            "realAlphaDamage": stats.and_then(|s| s.alpha_damage),
            "realShieldRegenRate": stats.and_then(|s| s.shield_regen_rate),
            "realPowerOutput": stats.and_then(|s| s.power_output),
        }));
    }

    let out = loadout_rows
        .iter()
        .map(|l| {
            let id = l.try_get::<i64, _>("id").unwrap_or_default();
            json!({
                "id": id,
                "shipId": l.try_get::<i64, _>("shipId").ok(),
                "profileName": l.try_get::<String, _>("profileName").unwrap_or_default(),
                "createdAt": l.try_get::<Option<String>, _>("createdAt").ok().flatten(),
                "updatedAt": l.try_get::<Option<String>, _>("updatedAt").ok().flatten(),
                "slots": slots_by_loadout.get(&id).cloned().unwrap_or_default(),
            })
        })
        .collect();

    Ok(out)
}

/* ─────────────────────────── get_ship_hardpoints ─────────────────────────── */

#[tauri::command]
pub async fn get_ship_hardpoints(
    ship_data_id: i64,
    db_instances: State<'_, DbInstances>,
) -> Result<Vec<Value>, String> {
    let instances = db_instances.0.read().await;
    let pool = sqlite_pool!(instances);

    let rows = sqlx::query(
        "SELECT id, portName, displayName, type, subType, minSize, maxSize,
                defaultComponentClassName, parentId
         FROM ShipHardpoint
         WHERE shipId = ? AND parentId IS NULL
         ORDER BY type ASC, displayName ASC",
    )
    .bind(ship_data_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows.iter().map(row_to_json).collect())
}

/* ────────────────────────── get_components_by_type ───────────────────────── */

#[tauri::command]
pub async fn get_components_by_type(
    slot_type: String,
    slot_size: i64,
    db_instances: State<'_, DbInstances>,
) -> Result<Vec<Value>, String> {
    let instances = db_instances.0.read().await;
    let pool = sqlite_pool!(instances);

    let rows = sqlx::query(
        "SELECT className, name, manufacturer, type, size, grade, class,
                dps, shieldHp, powerDraw, alphaDamage, shieldRegenRate, powerOutput, qtDriveSpeed
         FROM Component
         WHERE type = ? AND size <= ?
         ORDER BY size DESC, name ASC",
    )
    .bind(&slot_type)
    .bind(slot_size)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows.iter().map(row_to_json).collect())
}

/* ───────────────────────────────  save_loadout  ──────────────────────────── */

#[tauri::command]
#[allow(unused_variables)]
pub async fn save_loadout(
    ship_id: i64,
    profile_name: String,
    account_id: String,
    slots: Vec<Value>,
    db_instances: State<'_, DbInstances>,
) -> Result<i64, String> {
    let instances = db_instances.0.read().await;
    let pool = sqlite_pool!(instances);

    let loadout_id = sqlx::query(
        "INSERT INTO Loadout (shipId, profileName, createdAt, updatedAt)
         VALUES (?, ?, datetime('now'), datetime('now'))
         RETURNING id",
    )
    .bind(ship_id)
    .bind(&profile_name)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?
    .try_get::<i64, _>("id")
    .map_err(|e| e.to_string())?;

    for slot in &slots {
        let slot_type = val_str(slot, "slotType").unwrap_or_default();
        let slot_size = val_i64(slot, "slotSize").unwrap_or(1);
        sqlx::query(
            "INSERT INTO LoadoutSlot (loadoutId, slotType, slotSize, componentName,
                                      componentGrade, componentMake, portName, componentClassName)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(loadout_id)
        .bind(&slot_type)
        .bind(slot_size)
        .bind(val_str(slot, "componentName"))
        .bind(val_str(slot, "componentGrade"))
        .bind(val_str(slot, "componentMake"))
        .bind(val_str(slot, "portName"))
        .bind(val_str(slot, "componentClassName"))
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    }

    Ok(loadout_id)
}

/* ──────────────────────────────  delete_loadout  ─────────────────────────── */

#[tauri::command]
pub async fn delete_loadout(
    loadout_id: i64,
    db_instances: State<'_, DbInstances>,
) -> Result<(), String> {
    let instances = db_instances.0.read().await;
    let pool = sqlite_pool!(instances);

    sqlx::query("DELETE FROM Loadout WHERE id = ?")
        .bind(loadout_id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}
