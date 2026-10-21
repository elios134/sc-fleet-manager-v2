use serde_json::{json, Value};
use sqlx::Row;
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};
use tauri::State;
use tauri_plugin_sql::{DbInstances, DbPool};

use crate::DB_URL;
const WIKI_BASE: &str = "https://api.star-citizen.wiki/api/v2";

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
                category, craftTimeSeconds, imageUrl
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

    // Agrégation mémoire : compte + aperçu des 3 premiers ingrédients + liste COMPLÈTE des noms
    // (pour la recherche par matériau : « iron » → tous les blueprints qui en contiennent).
    let mut count_by_bp: HashMap<String, i64> = HashMap::new();
    let mut preview_by_bp: HashMap<String, Vec<String>> = HashMap::new();
    let mut names_by_bp: HashMap<String, Vec<String>> = HashMap::new();
    for r in &ing_rows {
        let bp_id = match r.try_get::<String, _>("blueprintId") {
            Ok(v) => v,
            Err(_) => continue,
        };
        *count_by_bp.entry(bp_id.clone()).or_insert(0) += 1;
        let name = r.try_get::<Option<String>, _>("ingredientName").ok().flatten();
        let label = match name {
            Some(n) if !n.trim().is_empty() => n,
            _ => r.try_get::<String, _>("ingredientRef").unwrap_or_default(),
        };
        names_by_bp.entry(bp_id.clone()).or_default().push(label.clone());
        let preview = preview_by_bp.entry(bp_id).or_default();
        if preview.len() < 3 {
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
        let image_url = row.try_get::<Option<String>, _>("imageUrl").ok().flatten();

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
            "imageUrl": image_url,
            "craftTimeSeconds": craft_time,
            "ingredientCount": count_by_bp.get(&id).copied().unwrap_or(0),
            "ingredientPreview": preview_by_bp.get(&id).cloned().unwrap_or_default(),
            "ingredientNames": names_by_bp.get(&id).cloned().unwrap_or_default(),
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
    let image_url = bp_row.try_get::<Option<String>, _>("imageUrl").ok().flatten();
    let description = bp_row.try_get::<Option<String>, _>("producedItemDescription").ok().flatten();
    // Description Data (liste {name, value}) parsée en tableau JSON (null si absente).
    let description_data: Value = bp_row
        .try_get::<Option<String>, _>("descriptionDataJson")
        .ok()
        .flatten()
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .filter(|v| v.is_array())
        .unwrap_or(Value::Null);
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
        "SELECT m.uuid, m.title, m.factionName, m.starSystems, mbr.weight
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
                "starSystems": r.try_get::<Option<String>, _>("starSystems").ok().flatten(),
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

    // Vignette : colonne persistée en priorité, sinon celle du repli live (itemDetails).
    let resolved_image = image_url.or_else(|| {
        item_details
            .get("imageUrl")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
    });

    Ok(json!({
        "blueprint": {
            "id": blueprint_id,
            "displayName": display_name,
            "displayNameSource": display_name_source,
            "producedItemName": produced,
            "category": category,
            "craftTimeSeconds": craft_time,
            "webUrl": web_url,
            "imageUrl": resolved_image,
            "descriptionData": description_data,
            "owned": owned,
        },
        "itemDetails": item_details,
        "ingredients": ingredients,
        "linkedMissions": linked_missions,
        "stats": stats,
    }))
}

/* ──────────────────────── get_blueprint_dismantle ────────────────────────── */

/// Recyclage (démantèlement) d'un blueprint — récupéré en live depuis le Wiki.
/// Appel PARESSEUX : le front ne l'invoque qu'à l'ouverture de l'onglet Recyclage
/// (et met le résultat en cache côté front), pour ne pas payer une requête réseau
/// à chaque ouverture de fiche. Value::Null si indisponible.
#[tauri::command]
pub async fn get_blueprint_dismantle(blueprint_id: String) -> Result<Value, String> {
    Ok(fetch_dismantle(&blueprint_id).await)
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

/* ───────────── Alias manuel : nom de log non apparié → blueprint ───────────── */

/// Associe un nom brut du Game.log (que l'auto-matching ne reconnaît pas) à un
/// blueprint choisi par l'utilisateur. Persiste l'alias (AppMeta, normalisé) pour
/// que les futurs re-cochages le reconnaissent, ET coche immédiatement le blueprint
/// pour le compte actif (add-only). Clé = nom de log normalisé (norm_match).
#[tauri::command]
pub async fn set_blueprint_log_alias(
    account_id: String,
    log_name: String,
    blueprint_id: String,
    db_instances: State<'_, DbInstances>,
) -> Result<Value, String> {
    let key = norm_match(&log_name);
    if key.is_empty() || blueprint_id.trim().is_empty() {
        return Err("Nom de log ou blueprint vide.".into());
    }
    let instances = db_instances.0.read().await;
    let pool = sqlite_pool!(instances);

    // Charge la table d'alias (nomNormalisé → blueprintId), met à jour, sauvegarde.
    let existing = sqlx::query("SELECT value FROM AppMeta WHERE key = 'crafting.blueprintLogAliases'")
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?
        .and_then(|r| r.try_get::<String, _>("value").ok());
    let mut map: HashMap<String, String> =
        existing.and_then(|j| serde_json::from_str(&j).ok()).unwrap_or_default();
    map.insert(key, blueprint_id.clone());
    let json = serde_json::to_string(&map).map_err(|e| e.to_string())?;
    sqlx::query("INSERT OR REPLACE INTO AppMeta (key, value) VALUES ('crafting.blueprintLogAliases', ?)")
        .bind(&json)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    // Coche tout de suite pour le compte actif (jamais de décochage).
    if !account_id.trim().is_empty() {
        sqlx::query(
            "INSERT OR IGNORE INTO UserCraftingBlueprintOwned (accountId, blueprintId, createdAt)
             VALUES (?, ?, datetime('now'))",
        )
        .bind(&account_id)
        .bind(&blueprint_id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    }

    Ok(json!({ "owned": true }))
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

// Sous-modules (déclarés après les macros locales, visibles par portée textuelle).
mod wiki_fetch;
pub(crate) use wiki_fetch::*;
pub(crate) mod log_resync;
pub(crate) use log_resync::*;