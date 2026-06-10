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

/// Choisit le nom affichable le plus fiable : producedItemName → name → recordName.
fn derive_display_name(
    produced: &Option<String>,
    name: &Option<String>,
    record: &str,
) -> (String, &'static str) {
    if let Some(p) = produced {
        if !p.trim().is_empty() {
            return (p.clone(), "producedItem");
        }
    }
    if let Some(n) = name {
        if !n.trim().is_empty() {
            return (n.clone(), "name");
        }
    }
    (record.to_string(), "recordName")
}

/* ───────────────────────────── list_blueprints ───────────────────────────── */

#[tauri::command]
pub async fn list_blueprints(db_instances: State<'_, DbInstances>) -> Result<Vec<Value>, String> {
    let instances = db_instances.0.read().await;
    let pool = sqlite_pool!(instances);

    let bp_rows = sqlx::query(
        "SELECT id, recordName, name, producedItemName, producedItemEntityClass,
                category, craftTimeSeconds
         FROM CraftingBlueprint
         ORDER BY COALESCE(producedItemName, name, recordName) ASC",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let ing_rows = sqlx::query(
        "SELECT blueprintId, ingredientName, ingredientRef, \"order\"
         FROM CraftingBlueprintIngredient
         ORDER BY blueprintId ASC, \"order\" ASC",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    // Agrégation mémoire : compte + aperçu des 3 premiers ingrédients par blueprint.
    let mut count_by_bp: HashMap<String, i64> = HashMap::new();
    let mut preview_by_bp: HashMap<String, Vec<String>> = HashMap::new();
    for r in &ing_rows {
        let bp_id = match r.try_get::<String, _>("blueprintId") {
            Ok(v) => v,
            Err(_) => continue,
        };
        *count_by_bp.entry(bp_id.clone()).or_insert(0) += 1;
        let preview = preview_by_bp.entry(bp_id).or_default();
        if preview.len() < 3 {
            let name = r.try_get::<Option<String>, _>("ingredientName").ok().flatten();
            let label = match name {
                Some(n) if !n.trim().is_empty() => n,
                _ => r.try_get::<String, _>("ingredientRef").unwrap_or_default(),
            };
            preview.push(label);
        }
    }

    let mut out = Vec::with_capacity(bp_rows.len());
    for row in &bp_rows {
        let id = row.try_get::<String, _>("id").map_err(|e| e.to_string())?;
        let record_name = row.try_get::<String, _>("recordName").map_err(|e| e.to_string())?;
        let name = row.try_get::<Option<String>, _>("name").ok().flatten();
        let produced_item_name = row.try_get::<Option<String>, _>("producedItemName").ok().flatten();
        let entity_class = row
            .try_get::<String, _>("producedItemEntityClass")
            .map_err(|e| e.to_string())?;
        let category = row.try_get::<String, _>("category").map_err(|e| e.to_string())?;
        let craft_time = row.try_get::<Option<i64>, _>("craftTimeSeconds").ok().flatten();

        let (display_name, display_name_source) =
            derive_display_name(&produced_item_name, &name, &record_name);

        out.push(json!({
            "id": id,
            "displayName": display_name,
            "displayNameSource": display_name_source,
            "category": category,
            "categoryGroupKey": category,
            "producedItemEntityClass": entity_class,
            "producedItemName": produced_item_name,
            "craftTimeSeconds": craft_time,
            "ingredientCount": count_by_bp.get(&id).copied().unwrap_or(0),
            "ingredientPreview": preview_by_bp.get(&id).cloned().unwrap_or_default(),
        }));
    }

    Ok(out)
}

/* ──────────────────────────── get_crafting_stats ─────────────────────────── */

#[tauri::command]
pub async fn get_crafting_stats(db_instances: State<'_, DbInstances>) -> Result<Value, String> {
    let instances = db_instances.0.read().await;
    let pool = sqlite_pool!(instances);

    let total = sqlx::query("SELECT COUNT(*) as total FROM CraftingBlueprint")
        .fetch_one(pool)
        .await
        .map_err(|e| e.to_string())?
        .try_get::<i64, _>("total")
        .map_err(|e| e.to_string())?;

    let rows = sqlx::query("SELECT category, COUNT(*) as count FROM CraftingBlueprint GROUP BY category")
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;

    let by_category: Vec<Value> = rows
        .iter()
        .map(|r| {
            json!({
                "category": r.try_get::<String, _>("category").unwrap_or_default(),
                "count": r.try_get::<i64, _>("count").unwrap_or(0),
            })
        })
        .collect();

    Ok(json!({ "total": total, "byCategory": by_category }))
}

/* ────────────────────────── get_blueprint_detail ─────────────────────────── */

#[tauri::command]
pub async fn get_blueprint_detail(
    blueprint_id: String,
    db_instances: State<'_, DbInstances>,
) -> Result<Value, String> {
    let instances = db_instances.0.read().await;
    let pool = sqlite_pool!(instances);

    let bp_row = sqlx::query("SELECT * FROM CraftingBlueprint WHERE id = ?")
        .bind(&blueprint_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?;

    let Some(bp_row) = bp_row else {
        return Ok(Value::Null);
    };

    let mut blueprint = row_to_json(&bp_row);
    // Ajoute le nom affichable calculé au même niveau que les colonnes brutes.
    let produced = bp_row.try_get::<Option<String>, _>("producedItemName").ok().flatten();
    let name = bp_row.try_get::<Option<String>, _>("name").ok().flatten();
    let record = bp_row.try_get::<String, _>("recordName").unwrap_or_default();
    let (display_name, display_name_source) = derive_display_name(&produced, &name, &record);
    if let Value::Object(ref mut map) = blueprint {
        map.insert("displayName".into(), json!(display_name));
        map.insert("displayNameSource".into(), json!(display_name_source));
    }

    let ing_rows = sqlx::query(
        "SELECT ingredientName, ingredientRef, ingredientType, quantity, slotName, \"order\"
         FROM CraftingBlueprintIngredient
         WHERE blueprintId = ?
         ORDER BY \"order\" ASC",
    )
    .bind(&blueprint_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let ingredients: Vec<Value> = ing_rows
        .iter()
        .map(|r| {
            json!({
                "ingredientName": r.try_get::<Option<String>, _>("ingredientName").ok().flatten(),
                "ingredientRef": r.try_get::<String, _>("ingredientRef").unwrap_or_default(),
                "ingredientType": r.try_get::<String, _>("ingredientType").unwrap_or_default(),
                "quantity": r.try_get::<f64, _>("quantity").unwrap_or(0.0),
                "slotName": r.try_get::<String, _>("slotName").unwrap_or_default(),
                "order": r.try_get::<i64, _>("order").unwrap_or(0),
            })
        })
        .collect();

    let mission_rows = sqlx::query(
        "SELECT m.uuid, m.title, m.factionName, mbr.weight
         FROM MissionBlueprintReward mbr
         JOIN Mission m ON m.uuid = mbr.missionUuid
         WHERE mbr.blueprintId = ?",
    )
    .bind(&blueprint_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let linked_missions: Vec<Value> = mission_rows
        .iter()
        .map(|r| {
            json!({
                "uuid": r.try_get::<String, _>("uuid").unwrap_or_default(),
                "title": r.try_get::<String, _>("title").unwrap_or_default(),
                "factionName": r.try_get::<Option<String>, _>("factionName").ok().flatten(),
                "weight": r.try_get::<f64, _>("weight").unwrap_or(0.0),
            })
        })
        .collect();

    Ok(json!({
        "blueprint": blueprint,
        "ingredients": ingredients,
        "linkedMissions": linked_missions,
    }))
}

/* ─────────────────────────── list_blueprint_owned ────────────────────────── */

#[tauri::command]
pub async fn list_blueprint_owned(
    account_id: String,
    db_instances: State<'_, DbInstances>,
) -> Result<Vec<String>, String> {
    let instances = db_instances.0.read().await;
    let pool = sqlite_pool!(instances);

    let rows = sqlx::query("SELECT blueprintId FROM UserCraftingBlueprintOwned WHERE accountId = ?")
        .bind(&account_id)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(rows
        .iter()
        .filter_map(|r| r.try_get::<String, _>("blueprintId").ok())
        .collect())
}

/* ────────────────────────── toggle_blueprint_owned ───────────────────────── */

#[tauri::command]
pub async fn toggle_blueprint_owned(
    account_id: String,
    blueprint_id: String,
    db_instances: State<'_, DbInstances>,
) -> Result<Value, String> {
    let instances = db_instances.0.read().await;
    let pool = sqlite_pool!(instances);

    let existing = sqlx::query(
        "SELECT id FROM UserCraftingBlueprintOwned WHERE accountId = ? AND blueprintId = ?",
    )
    .bind(&account_id)
    .bind(&blueprint_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;

    if existing.is_some() {
        sqlx::query("DELETE FROM UserCraftingBlueprintOwned WHERE accountId = ? AND blueprintId = ?")
            .bind(&account_id)
            .bind(&blueprint_id)
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;
        Ok(json!({ "owned": false }))
    } else {
        sqlx::query(
            "INSERT INTO UserCraftingBlueprintOwned (accountId, blueprintId, createdAt)
             VALUES (?, ?, datetime('now'))",
        )
        .bind(&account_id)
        .bind(&blueprint_id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
        Ok(json!({ "owned": true }))
    }
}
