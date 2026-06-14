use serde_json::{json, Value};
use sqlx::Row;
use std::collections::HashMap;
use std::time::Duration;
use tauri::State;
use tauri_plugin_sql::{DbInstances, DbPool};

const DB_URL: &str = "sqlite:scfleet.db";
const WIKI_BASE: &str = "https://api.star-citizen.wiki/api/v2";

/// GET JSON best-effort pour la modale (timeout court, aucune reprise). None si échec.
async fn fetch_json(client: &reqwest::Client, url: &str) -> Option<Value> {
    let resp = client.get(url).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    resp.json::<Value>().await.ok()
}

/// String non vide pour une clé d'un sous-objet JSON.
fn jstr(v: &Value, key: &str) -> Option<String> {
    v.get(key)
        .and_then(|x| x.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Détails de l'objet produit pour la modale. 2 appels best-effort :
/// `/blueprints/{id}` (→ uuid de l'output) puis `/items/{uuid}`. None si indisponible —
/// la modale s'ouvre alors sans le bloc détaillé.
async fn fetch_item_details(blueprint_id: &str) -> Option<Value> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .user_agent("SCFleetManager/2.0")
        .build()
        .ok()?;

    // 1) uuid de l'objet produit (non stocké en base, récupéré live).
    let bp = fetch_json(&client, &format!("{WIKI_BASE}/blueprints/{blueprint_id}")).await?;
    let body = bp.get("data").unwrap_or(&bp);
    let output_uuid = jstr(body, "output_item_uuid")
        .or_else(|| body.get("output").and_then(|o| jstr(o, "uuid")))?;

    // 2) détails de l'objet (/items résout l'uuid de l'output, même référentiel).
    let item = fetch_json(&client, &format!("{WIKI_BASE}/items/{output_uuid}")).await?;
    let it = item.get("data").unwrap_or(&item);

    // description : fr_FR sinon en_EN.
    let description = it
        .get("description")
        .and_then(|d| jstr(d, "fr_FR").or_else(|| jstr(d, "en_EN")));
    let manufacturer = it
        .get("manufacturer")
        .and_then(|m| jstr(m, "name"))
        .filter(|s| s != "Unknown");

    Some(json!({
        "description": description,
        "manufacturer": manufacturer,
        "itemType": jstr(it, "type_label"),
        "subType": jstr(it, "sub_type_label"),
        "size": it.get("size").and_then(|s| s.as_i64()),
        "grade": jstr(it, "grade"),
        "className": jstr(it, "class_name"),
    }))
}

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
    account_id: String,
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

    let produced = bp_row.try_get::<Option<String>, _>("producedItemName").ok().flatten();
    let name = bp_row.try_get::<Option<String>, _>("name").ok().flatten();
    let record = bp_row.try_get::<String, _>("recordName").unwrap_or_default();
    let category = bp_row.try_get::<Option<String>, _>("category").ok().flatten();
    let craft_time = bp_row.try_get::<Option<i64>, _>("craftTimeSeconds").ok().flatten();
    let (display_name, display_name_source) = derive_display_name(&produced, &name, &record);

    // Métadonnées objet persistées (R0) pour l'en-tête, sans appel live. className réutilise
    // producedItemEntityClass ; description réutilise producedItemDescription.
    let meta_grade = bp_row.try_get::<Option<String>, _>("grade").ok().flatten();
    let meta_size = bp_row.try_get::<Option<i64>, _>("size").ok().flatten();
    let meta_manufacturer = bp_row.try_get::<Option<String>, _>("manufacturer").ok().flatten();
    let meta_item_type = bp_row.try_get::<Option<String>, _>("itemType").ok().flatten();
    let meta_sub_type = bp_row.try_get::<Option<String>, _>("subType").ok().flatten();
    let web_url = bp_row.try_get::<Option<String>, _>("webUrl").ok().flatten();
    let class_name = bp_row.try_get::<Option<String>, _>("producedItemEntityClass").ok().flatten();
    let description = bp_row.try_get::<Option<String>, _>("producedItemDescription").ok().flatten();
    // Meta présentes ? sinon (blueprint pas encore re-synchronisé) → repli appel live.
    let has_meta = meta_grade.is_some() || meta_size.is_some() || meta_manufacturer.is_some();

    // Stats de craft (producedItemStatsJson) parsées en tableau (vide si absent/non peuplé).
    let stats: Value = bp_row
        .try_get::<Option<String>, _>("producedItemStatsJson")
        .ok()
        .flatten()
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .filter(|v| v.is_array())
        .unwrap_or_else(|| json!([]));

    // owned par compte actif (false si pas de compte).
    let owned = if account_id.is_empty() {
        false
    } else {
        sqlx::query(
            "SELECT 1 FROM UserCraftingBlueprintOwned WHERE accountId = ? AND blueprintId = ?",
        )
        .bind(&account_id)
        .bind(&blueprint_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?
        .is_some()
    };

    // Ingrédients : par emplacement (slotName/slotLabel + alternatives via selectionGroup).
    // Repli : si non enrichis, slotName vaut 'Recette' → le front affiche une liste à plat.
    let ing_rows = sqlx::query(
        "SELECT ingredientName, ingredientRef, ingredientType, quantity, \"order\",
                slotName, slotLabel, requiredCount, selectionGroup,
                minQuality, sliderMin, sliderMax, initialQuality, modifiersJson
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
            let itype = r.try_get::<String, _>("ingredientType").unwrap_or_default();
            let iname = r.try_get::<Option<String>, _>("ingredientName").ok().flatten();
            let iref = r.try_get::<String, _>("ingredientRef").unwrap_or_default();
            let qty = r.try_get::<f64, _>("quantity").unwrap_or(0.0);
            let order = r.try_get::<i64, _>("order").unwrap_or(0);
            let is_resource = itype == "resource";
            let type_label = if is_resource { "Ressource" } else { "Objet" };
            // resource → SCU (arrondi 2 déc.) ; item → ×N.
            let quantity_label = if is_resource {
                format!("{} SCU", (qty * 100.0).round() / 100.0)
            } else {
                format!("×{}", qty.round() as i64)
            };
            let label = iname
                .filter(|s| !s.trim().is_empty())
                .unwrap_or_else(|| iref.clone());
            json!({
                "ingredientName": label,
                "ingredientRef": iref,
                "ingredientType": itype,
                "ingredientTypeLabel": type_label,
                "quantityLabel": quantity_label,
                "order": order,
                "slotName": r.try_get::<Option<String>, _>("slotName").ok().flatten(),
                "slotLabel": r.try_get::<Option<String>, _>("slotLabel").ok().flatten(),
                "requiredCount": r.try_get::<Option<i64>, _>("requiredCount").ok().flatten(),
                "selectionGroup": r.try_get::<Option<String>, _>("selectionGroup").ok().flatten(),
                "minQuality": r.try_get::<Option<i64>, _>("minQuality").ok().flatten(),
                "sliderMin": r.try_get::<Option<i64>, _>("sliderMin").ok().flatten(),
                "sliderMax": r.try_get::<Option<i64>, _>("sliderMax").ok().flatten(),
                "initialQuality": r.try_get::<Option<i64>, _>("initialQuality").ok().flatten(),
                // modifiersJson (TEXT) → tableau JSON parsé (ou null) pour le simulateur.
                "modifiers": r
                    .try_get::<Option<String>, _>("modifiersJson")
                    .ok()
                    .flatten()
                    .and_then(|s| serde_json::from_str::<Value>(&s).ok())
                    .unwrap_or(Value::Null),
            })
        })
        .collect();

    // Missions liées : jointure Mission → toutes présentes en base → navigables.
    let mission_rows = sqlx::query(
        "SELECT m.uuid, m.title, m.factionName, mbr.weight
         FROM MissionBlueprintReward mbr
         JOIN Mission m ON m.uuid = mbr.missionUuid
         WHERE mbr.blueprintId = ?
         ORDER BY mbr.weight DESC",
    )
    .bind(&blueprint_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let linked_missions: Vec<Value> = mission_rows
        .iter()
        .map(|r| {
            json!({
                "missionUuid": r.try_get::<String, _>("uuid").unwrap_or_default(),
                "title": r.try_get::<String, _>("title").unwrap_or_default(),
                "factionName": r.try_get::<Option<String>, _>("factionName").ok().flatten(),
                "weight": r.try_get::<f64, _>("weight").unwrap_or(0.0),
                "navigable": true,
            })
        })
        .collect();

    // Libère le verrou DB avant les éventuels appels réseau (ne pas le tenir pendant l'I/O).
    drop(instances);

    // itemDetails : depuis la base (R0, sans appel live). Repli sur l'appel live si le
    // blueprint n'a pas encore été re-synchronisé (meta absentes).
    let item_details = if has_meta {
        json!({
            "description": description,
            "manufacturer": meta_manufacturer,
            "itemType": meta_item_type,
            "subType": meta_sub_type,
            "size": meta_size,
            "grade": meta_grade,
            "className": class_name,
        })
    } else {
        fetch_item_details(&blueprint_id).await.unwrap_or(Value::Null)
    };

    Ok(json!({
        "blueprint": {
            "id": blueprint_id,
            "displayName": display_name,
            "displayNameSource": display_name_source,
            "producedItemName": produced,
            "category": category,
            "craftTimeSeconds": craft_time,
            "webUrl": web_url,
            "owned": owned,
        },
        "itemDetails": item_details,
        "ingredients": ingredients,
        "linkedMissions": linked_missions,
        "stats": stats,
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

/* ──────────────────── get_ingredient_mining_locations ────────────────────── */

/// Capitalise une clé brute de corps ("aaron_halo" → "Aaron Halo"). Repli quand
/// bodyName est nul (calque V1 capitaliseRawBodyKey).
fn capitalise_body_key(raw: &str) -> String {
    let s = raw
        .split('_')
        .filter(|p| !p.is_empty())
        .map(|p| {
            let mut c = p.chars();
            match c.next() {
                Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ");
    if s.is_empty() {
        raw.to_string()
    } else {
        s
    }
}

/// Localisations de minage d'un ingrédient (modale « où miner »).
///
/// Matching : la V2 stocke un **uuid** dans `ingredientRef` (non normalisable). On résout
/// d'abord le **nom** de l'ingrédient depuis la base, puis le stem via `normalise_to_stem`
/// + `apply_stem_alias` (port V1), pour interroger `ResourceMiningLocation.resourceStem`.
/// Renvoie `[]` si pas de match (modale → « données à venir »). Front inchangé.
#[tauri::command]
pub async fn get_ingredient_mining_locations(
    ingredient_ref: String,
    db_instances: State<'_, DbInstances>,
) -> Result<Vec<Value>, String> {
    let instances = db_instances.0.read().await;
    let pool = sqlite_pool!(instances);

    // uuid → nom de l'ingrédient (stocké en base), repli sur le ref brut.
    let name = sqlx::query(
        "SELECT ingredientName FROM CraftingBlueprintIngredient
         WHERE ingredientRef = ? AND ingredientName IS NOT NULL AND ingredientName != ''
         LIMIT 1",
    )
    .bind(&ingredient_ref)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?
    .and_then(|r| r.try_get::<String, _>("ingredientName").ok())
    .unwrap_or_else(|| ingredient_ref.clone());

    let stem = crate::commands::datamining::apply_stem_alias(
        &crate::commands::datamining::normalise_to_stem(&name),
    );

    let rows = sqlx::query(
        "SELECT systemName, rawBodyKey, bodyName, miningMethod, rarity
         FROM ResourceMiningLocation
         WHERE resourceStem = ?
         ORDER BY rarity ASC, systemName ASC, bodyName ASC",
    )
    .bind(&stem)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows
        .iter()
        .map(|r| {
            let raw_body = r.try_get::<String, _>("rawBodyKey").unwrap_or_default();
            let body = r
                .try_get::<Option<String>, _>("bodyName")
                .ok()
                .flatten()
                .filter(|s| !s.trim().is_empty())
                .unwrap_or_else(|| capitalise_body_key(&raw_body));
            json!({
                "systemName": r.try_get::<String, _>("systemName").unwrap_or_default(),
                "rawBodyKey": raw_body,
                "bodyName": body,
                "miningMethod": r.try_get::<String, _>("miningMethod").unwrap_or_default(),
                "rarity": r.try_get::<Option<String>, _>("rarity").ok().flatten(),
            })
        })
        .collect())
}
