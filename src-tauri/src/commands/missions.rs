use serde_json::{json, Map, Value};
use sqlx::Row;
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

/// Lit une colonne texte optionnelle (NULL → None).
fn opt_str(row: &sqlx::sqlite::SqliteRow, col: &str) -> Option<String> {
    row.try_get::<Option<String>, _>(col).ok().flatten()
}

/// Lit une colonne entière optionnelle (NULL → None).
fn opt_i64(row: &sqlx::sqlite::SqliteRow, col: &str) -> Option<i64> {
    row.try_get::<Option<i64>, _>(col).ok().flatten()
}

/// Lit un flag INTEGER 0/1 en booléen.
fn flag(row: &sqlx::sqlite::SqliteRow, col: &str) -> bool {
    row.try_get::<Option<i64>, _>(col).ok().flatten().unwrap_or(0) != 0
}

/// Vrai si la mission correspond à au moins un type sélectionné (OR).
fn matches_types(reward_scope: Option<&str>, illegal: bool, types: &[String]) -> bool {
    types.iter().any(|t| match t.as_str() {
        "Cargo" => matches!(reward_scope, Some("Cargo") | Some("Cargo Transport")),
        "Combat" => matches!(reward_scope, Some("Combat") | Some("Combat Assist")),
        "ILLEGAL" => illegal,
        other => reward_scope == Some(other),
    })
}

/* ───────────────────────────── list_missions ────────────────────────────── */

#[tauri::command]
pub async fn list_missions(
    types: Vec<String>,
    factions: Vec<String>,
    db_instances: State<'_, DbInstances>,
) -> Result<Vec<Value>, String> {
    let instances = db_instances.0.read().await;
    let pool = sqlite_pool!(instances);

    // Requête 1 — missions.
    let mission_rows = sqlx::query(
        "SELECT uuid, title, description, factionName, factionUuid, factionType,
                rewardScope, illegal, legalityLabel, hasBlueprints, blueprintDropChance,
                rewardMin, rewardMax, rewardCurrency, timeMins, shareable,
                hasCombat, hasHauling, hasDefend,
                minStandingName, minStandingValue, maxStandingName, maxStandingValue,
                released, workInProgress, notForRelease, starSystems,
                reputationGained, cooldownJson, reputationAmount, gameVersion, webUrl, source
         FROM Mission
         ORDER BY title ASC",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    // Requête 2 — blueprints, regroupés par missionUuid.
    let bp_rows = sqlx::query("SELECT missionUuid, name, itemUuid FROM MissionBlueprint")
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;

    let mut blueprints_by_mission: HashMap<String, Vec<Value>> = HashMap::new();
    for r in &bp_rows {
        let mission_uuid = r.try_get::<String, _>("missionUuid").map_err(|e| e.to_string())?;
        let name = r.try_get::<String, _>("name").map_err(|e| e.to_string())?;
        let item_uuid = r.try_get::<String, _>("itemUuid").map_err(|e| e.to_string())?;
        blueprints_by_mission
            .entry(mission_uuid)
            .or_default()
            .push(json!({ "name": name, "itemUuid": item_uuid }));
    }

    let has_type_filter = !types.is_empty();
    let has_faction_filter = !factions.is_empty();

    let mut out = Vec::with_capacity(mission_rows.len());
    for row in &mission_rows {
        let uuid = row.try_get::<String, _>("uuid").map_err(|e| e.to_string())?;
        let faction_name = opt_str(row, "factionName");
        let reward_scope = opt_str(row, "rewardScope");
        let illegal = flag(row, "illegal");

        // Filtres côté Rust (avant sérialisation).
        if has_faction_filter {
            match &faction_name {
                Some(f) if factions.contains(f) => {}
                _ => continue,
            }
        }
        if has_type_filter && !matches_types(reward_scope.as_deref(), illegal, &types) {
            continue;
        }

        let blueprints = blueprints_by_mission
            .get(&uuid)
            .cloned()
            .unwrap_or_default();

        let mut obj = Map::new();
        obj.insert("uuid".into(), json!(uuid));
        obj.insert("title".into(), json!(row.try_get::<String, _>("title").map_err(|e| e.to_string())?));
        obj.insert("description".into(), json!(opt_str(row, "description")));
        obj.insert("factionName".into(), json!(faction_name));
        obj.insert("factionUuid".into(), json!(opt_str(row, "factionUuid")));
        obj.insert("factionType".into(), json!(opt_str(row, "factionType")));
        obj.insert("rewardScope".into(), json!(reward_scope));
        obj.insert("illegal".into(), json!(illegal));
        obj.insert("legalityLabel".into(), json!(opt_str(row, "legalityLabel")));
        obj.insert("hasBlueprints".into(), json!(flag(row, "hasBlueprints")));
        obj.insert(
            "blueprintDropChance".into(),
            json!(row.try_get::<Option<f64>, _>("blueprintDropChance").ok().flatten()),
        );
        obj.insert("rewardMin".into(), json!(opt_i64(row, "rewardMin")));
        obj.insert("rewardMax".into(), json!(opt_i64(row, "rewardMax")));
        obj.insert("rewardCurrency".into(), json!(opt_str(row, "rewardCurrency")));
        obj.insert("timeMins".into(), json!(opt_i64(row, "timeMins")));
        obj.insert("shareable".into(), json!(flag(row, "shareable")));
        obj.insert("hasCombat".into(), json!(flag(row, "hasCombat")));
        obj.insert("hasHauling".into(), json!(flag(row, "hasHauling")));
        obj.insert("hasDefend".into(), json!(flag(row, "hasDefend")));
        obj.insert("minStandingName".into(), json!(opt_str(row, "minStandingName")));
        obj.insert("minStandingValue".into(), json!(opt_i64(row, "minStandingValue")));
        obj.insert("maxStandingName".into(), json!(opt_str(row, "maxStandingName")));
        obj.insert("maxStandingValue".into(), json!(opt_i64(row, "maxStandingValue")));
        obj.insert("released".into(), json!(flag(row, "released")));
        obj.insert("workInProgress".into(), json!(flag(row, "workInProgress")));
        obj.insert("notForRelease".into(), json!(flag(row, "notForRelease")));
        obj.insert("starSystems".into(), json!(opt_str(row, "starSystems")));
        obj.insert("reputationGained".into(), json!(opt_str(row, "reputationGained")));
        obj.insert("cooldownJson".into(), json!(opt_str(row, "cooldownJson")));
        obj.insert("reputationAmount".into(), json!(opt_i64(row, "reputationAmount")));
        obj.insert("gameVersion".into(), json!(opt_str(row, "gameVersion")));
        obj.insert("webUrl".into(), json!(opt_str(row, "webUrl")));
        obj.insert("source".into(), json!(row.try_get::<String, _>("source").map_err(|e| e.to_string())?));
        obj.insert("blueprints".into(), Value::Array(blueprints));

        out.push(Value::Object(obj));
    }

    Ok(out)
}

/* ────────────────────────── get_distinct_factions ───────────────────────── */

#[tauri::command]
pub async fn get_distinct_factions(
    db_instances: State<'_, DbInstances>,
) -> Result<Vec<String>, String> {
    let instances = db_instances.0.read().await;
    let pool = sqlite_pool!(instances);

    let rows = sqlx::query(
        "SELECT DISTINCT factionName FROM Mission
         WHERE factionName IS NOT NULL ORDER BY factionName ASC",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows
        .iter()
        .filter_map(|r| r.try_get::<String, _>("factionName").ok())
        .collect())
}

/* ─────────────────────────── get_missions_status ─────────────────────────── */

#[tauri::command]
pub async fn get_missions_status(db_instances: State<'_, DbInstances>) -> Result<Value, String> {
    let instances = db_instances.0.read().await;
    let pool = sqlite_pool!(instances);

    let mission_count = sqlx::query("SELECT COUNT(*) as count FROM Mission")
        .fetch_one(pool)
        .await
        .map_err(|e| e.to_string())?
        .try_get::<i64, _>("count")
        .map_err(|e| e.to_string())?;

    let last_synced_at = sqlx::query("SELECT value FROM AppMeta WHERE key = 'missions.lastSyncedAt'")
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?
        .and_then(|r| r.try_get::<String, _>("value").ok());

    let last_synced_game_version =
        sqlx::query("SELECT value FROM AppMeta WHERE key = 'missions.lastSyncedGameVersion'")
            .fetch_optional(pool)
            .await
            .map_err(|e| e.to_string())?
            .and_then(|r| r.try_get::<String, _>("value").ok());

    Ok(json!({
        "missionCount": mission_count,
        "lastSyncedAt": last_synced_at,
        "lastSyncedGameVersion": last_synced_game_version,
    }))
}

/* ───────────────────────────── list_objectives ───────────────────────────── */

#[tauri::command]
pub async fn list_objectives(
    account_id: String,
    db_instances: State<'_, DbInstances>,
) -> Result<Vec<Value>, String> {
    let instances = db_instances.0.read().await;
    let pool = sqlite_pool!(instances);

    let rows = sqlx::query(
        "SELECT m.uuid, m.title, m.factionName, m.rewardScope, m.reputationAmount,
                uo.status, uo.notes, uo.updatedAt
         FROM UserMissionObjective uo
         JOIN Mission m ON m.uuid = uo.missionUuid
         WHERE uo.accountId = ?
         ORDER BY uo.updatedAt DESC",
    )
    .bind(&account_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows
        .iter()
        .map(|row| {
            json!({
                "uuid": row.try_get::<String, _>("uuid").unwrap_or_default(),
                "title": row.try_get::<String, _>("title").unwrap_or_default(),
                "factionName": opt_str(row, "factionName"),
                "rewardScope": opt_str(row, "rewardScope"),
                "reputationAmount": opt_i64(row, "reputationAmount"),
                "status": opt_str(row, "status"),
                "notes": opt_str(row, "notes"),
                "updatedAt": opt_str(row, "updatedAt"),
            })
        })
        .collect())
}

/* ──────────────────────────── toggle_objective ───────────────────────────── */

#[tauri::command]
pub async fn toggle_objective(
    account_id: String,
    mission_uuid: String,
    db_instances: State<'_, DbInstances>,
) -> Result<Value, String> {
    let instances = db_instances.0.read().await;
    let pool = sqlite_pool!(instances);

    let existing =
        sqlx::query("SELECT id FROM UserMissionObjective WHERE accountId = ? AND missionUuid = ?")
            .bind(&account_id)
            .bind(&mission_uuid)
            .fetch_optional(pool)
            .await
            .map_err(|e| e.to_string())?;

    if existing.is_some() {
        sqlx::query("DELETE FROM UserMissionObjective WHERE accountId = ? AND missionUuid = ?")
            .bind(&account_id)
            .bind(&mission_uuid)
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;
        Ok(json!({ "active": false }))
    } else {
        sqlx::query(
            "INSERT INTO UserMissionObjective (accountId, missionUuid, status, createdAt, updatedAt)
             VALUES (?, ?, 'active', datetime('now'), datetime('now'))",
        )
        .bind(&account_id)
        .bind(&mission_uuid)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
        Ok(json!({ "active": true }))
    }
}

/* ───────────────────────────── list_favorites ────────────────────────────── */

#[tauri::command]
pub async fn list_favorites(
    account_id: String,
    db_instances: State<'_, DbInstances>,
) -> Result<Vec<Value>, String> {
    let instances = db_instances.0.read().await;
    let pool = sqlite_pool!(instances);

    let rows = sqlx::query(
        "SELECT m.uuid, m.title, m.factionName, m.rewardScope, m.reputationAmount,
                uf.note, uf.createdAt
         FROM UserMissionFavorite uf
         JOIN Mission m ON m.uuid = uf.missionUuid
         WHERE uf.accountId = ?
         ORDER BY uf.createdAt DESC",
    )
    .bind(&account_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows
        .iter()
        .map(|row| {
            json!({
                "uuid": row.try_get::<String, _>("uuid").unwrap_or_default(),
                "title": row.try_get::<String, _>("title").unwrap_or_default(),
                "factionName": opt_str(row, "factionName"),
                "rewardScope": opt_str(row, "rewardScope"),
                "reputationAmount": opt_i64(row, "reputationAmount"),
                "note": opt_str(row, "note"),
                "createdAt": opt_str(row, "createdAt"),
            })
        })
        .collect())
}

/* ──────────────────────────── toggle_favorite ────────────────────────────── */

#[tauri::command]
pub async fn toggle_favorite(
    account_id: String,
    mission_uuid: String,
    db_instances: State<'_, DbInstances>,
) -> Result<Value, String> {
    let instances = db_instances.0.read().await;
    let pool = sqlite_pool!(instances);

    let existing =
        sqlx::query("SELECT id FROM UserMissionFavorite WHERE accountId = ? AND missionUuid = ?")
            .bind(&account_id)
            .bind(&mission_uuid)
            .fetch_optional(pool)
            .await
            .map_err(|e| e.to_string())?;

    if existing.is_some() {
        sqlx::query("DELETE FROM UserMissionFavorite WHERE accountId = ? AND missionUuid = ?")
            .bind(&account_id)
            .bind(&mission_uuid)
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;
        Ok(json!({ "favorite": false }))
    } else {
        sqlx::query(
            "INSERT INTO UserMissionFavorite (accountId, missionUuid, createdAt)
             VALUES (?, ?, datetime('now'))",
        )
        .bind(&account_id)
        .bind(&mission_uuid)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
        Ok(json!({ "favorite": true }))
    }
}

/* ────────────────────────── update_favorite_note ─────────────────────────── */

#[tauri::command]
pub async fn update_favorite_note(
    account_id: String,
    mission_uuid: String,
    note: Option<String>,
    db_instances: State<'_, DbInstances>,
) -> Result<(), String> {
    let instances = db_instances.0.read().await;
    let pool = sqlite_pool!(instances);

    sqlx::query("UPDATE UserMissionFavorite SET note = ? WHERE accountId = ? AND missionUuid = ?")
        .bind(&note)
        .bind(&account_id)
        .bind(&mission_uuid)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}
