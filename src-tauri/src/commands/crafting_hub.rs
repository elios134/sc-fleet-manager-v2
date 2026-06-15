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

    Ok(json!({
        "blueprint": {
            "id": blueprint_id,
            "displayName": display_name,
            "displayNameSource": display_name_source,
            "producedItemName": produced,
            "category": category,
            "craftTimeSeconds": craft_time,
            "webUrl": web_url,
            "descriptionData": description_data,
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

/* ───────────────────────── Re-cochage via Game.log ─────────────────────────
   Détecte les blueprints débloqués en jeu en lisant Game.log (+ logbackups) et
   coche les blueprints correspondants (ADD-ONLY). Logique de parsing portée de V1
   (blueprintLogParser.ts). Matching sur producedItemName (EN) — producedItemNameFr
   étant vide en V2 (cf. audit) ; les noms FR traduits restent « non appariés ».      */

/// Extrait les noms de produits débloqués depuis le texte d'un Game.log (port V1).
/// Normalise un nom pour le matching tolérant Game.log ↔ base :
/// minuscule, tout espace Unicode (dont NBSP `\u{00A0}` / NNBSP `\u{202F}` des
/// noms FR du global.ini) ramené à un espace simple + collapse, et retrait des
/// guillemets/parenthèses (le jeu loggue `"Warhawk"` là où la base a `(Warhawk)`).
/// Sûr : ne fusionne pas d'items distincts (ambiguïté globale 35→33 sur la base).
fn norm_match(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut pending_space = false;
    for c in s.chars().flat_map(char::to_lowercase) {
        match c {
            '"' | '\'' | '\u{201C}' | '\u{201D}' | '\u{00AB}' | '\u{00BB}' | '(' | ')' => continue,
            c if c.is_whitespace() => {
                if !out.is_empty() {
                    pending_space = true;
                }
            }
            c => {
                if pending_space {
                    out.push(' ');
                    pending_space = false;
                }
                out.push(c);
            }
        }
    }
    out
}

/// Ligne primaire = contient `<SHUDEvent_OnNotification>` ET `Added notification "<txt>" [<id>]`,
/// dont `<txt>` matche « Received Blueprint: <nom>: » (EN) ou « Schémas reçu(s) : <nom>: » (FR).
fn parse_blueprint_unlocks(text: &str, out: &mut Vec<String>, seen: &mut std::collections::HashSet<String>) {
    use regex::Regex;
    // Compilées à chaque appel de fichier (volume modeste : Game.log + quelques backups).
    let notif_re = Regex::new(r#"Added notification "(.*?)"\s*\[(\d+)\]"#).expect("notif regex");
    let product_re =
        Regex::new(r"(?:Received Blueprint: (.+?):|Sch[eé]mas? reçus? : (.+?):)").expect("product regex");
    for line in text.lines() {
        if !line.contains("<SHUDEvent_OnNotification>") {
            continue;
        }
        let Some(caps) = notif_re.captures(line) else { continue };
        let quoted = caps.get(1).map(|m| m.as_str()).unwrap_or("");
        let Some(pcaps) = product_re.captures(quoted) else { continue };
        let name = pcaps
            .get(1)
            .or_else(|| pcaps.get(2))
            .map(|m| m.as_str().trim().to_string())
            .filter(|s| !s.is_empty());
        if let Some(name) = name {
            let key = name.to_lowercase();
            if seen.insert(key) {
                out.push(name);
            }
        }
    }
}

/// Lecture LOSSY (port de V1 readLossy) : les Game.log SC ne sont PAS de l'UTF-8 strict
/// (octets invalides épars) → `read_to_string` échouerait sur tout le fichier (→ 0 détecté).
/// On lit les octets et on décode en remplaçant les invalides (le « é » UTF-8 c3a9 reste
/// intact), puis on retire un éventuel BOM.
fn read_lossy(path: &std::path::Path) -> Option<String> {
    let bytes = std::fs::read(path).ok()?;
    let s = String::from_utf8_lossy(&bytes).into_owned();
    Some(s.strip_prefix('\u{feff}').map(str::to_string).unwrap_or(s))
}

/// Lit Game.log + logbackups/*.log à la racine de l'install et renvoie les noms distincts
/// de blueprints débloqués. Liste vide si install/log introuvable.
fn detect_unlocked_names(install_path: &str) -> Vec<String> {
    use std::path::Path;
    let root = Path::new(install_path);
    let mut out: Vec<String> = Vec::new();
    let mut seen = std::collections::HashSet::new();

    if let Some(text) = read_lossy(&root.join("Game.log")) {
        parse_blueprint_unlocks(&text, &mut out, &mut seen);
    }
    if let Ok(entries) = std::fs::read_dir(root.join("logbackups")) {
        let mut backups: Vec<std::path::PathBuf> = entries
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| p.extension().and_then(|x| x.to_str()).map(|x| x.eq_ignore_ascii_case("log")).unwrap_or(false))
            .collect();
        backups.sort();
        for p in backups {
            if let Some(text) = read_lossy(&p) {
                parse_blueprint_unlocks(&text, &mut out, &mut seen);
            }
        }
    }
    out
}

/// Re-coche les blueprints débloqués en jeu (lecture Game.log). Matching EN sur
/// producedItemName (insensible casse) ; ambigus (>1) ignorés ; ADD-ONLY (jamais décoché).
/// Renvoie un récap + la liste des noms non appariés (perte due à la traduction FR).
#[tauri::command]
pub async fn resync_blueprints_from_log(
    account_id: String,
    db_instances: State<'_, DbInstances>,
) -> Result<Value, String> {
    if account_id.trim().is_empty() {
        return Err("Aucun compte actif.".into());
    }
    let instances = db_instances.0.read().await;
    let pool = sqlite_pool!(instances);

    // Chemin d'install (chemin manuel AppMeta prioritaire, sinon cascade).
    let configured = sqlx::query("SELECT value FROM AppMeta WHERE key = 'datamining.scInstallPath'")
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
        .and_then(|r| r.try_get::<String, _>("value").ok());
    let install = crate::commands::patch_detect::resolve_sc_install(configured);
    let Some((install_path, _channel)) = install else {
        return Ok(json!({
            "logFound": false, "detected": 0, "alreadyOwned": 0,
            "newlyChecked": 0, "ambiguousSkipped": 0, "unmatched": 0, "unmatchedNames": [],
        }));
    };

    let detected = detect_unlocked_names(&install_path);
    if detected.is_empty() {
        return Ok(json!({
            "logFound": true, "detected": 0, "alreadyOwned": 0,
            "newlyChecked": 0, "ambiguousSkipped": 0, "unmatched": 0, "unmatchedNames": [],
        }));
    }

    // Index nom (minuscule) → ids DISTINCTS de blueprints. On indexe le nom EN ET
    // le nom FR (producedItemNameFr, s'il existe) vers le MÊME id : un log EN ou FR
    // matche ainsi le bon blueprint. >1 id DISTINCT pour un nom = ambiguïté réelle ;
    // EN + FR d'un même BP partagent le même id → ce n'est PAS une ambiguïté.
    fn index_name(map: &mut HashMap<String, Vec<String>>, raw: &str, id: &str) {
        let key = norm_match(raw);
        if key.is_empty() || id.is_empty() {
            return;
        }
        let ids = map.entry(key).or_default();
        if !ids.iter().any(|x| x == id) {
            ids.push(id.to_string());
        }
    }

    let mut by_name: HashMap<String, Vec<String>> = HashMap::new();
    let bp_rows = sqlx::query(
        "SELECT id, producedItemName, producedItemNameFr FROM CraftingBlueprint \
         WHERE (producedItemName IS NOT NULL AND producedItemName <> '') \
            OR (producedItemNameFr IS NOT NULL AND producedItemNameFr <> '')",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;
    for r in &bp_rows {
        let id: String = r.try_get("id").unwrap_or_default();
        // Nom EN (inchangé : zéro régression) puis nom FR (si non NULL).
        if let Some(en) = r.try_get::<Option<String>, _>("producedItemName").ok().flatten() {
            index_name(&mut by_name, &en, &id);
        }
        if let Some(fr) = r.try_get::<Option<String>, _>("producedItemNameFr").ok().flatten() {
            index_name(&mut by_name, &fr, &id);
        }
    }

    // Alias manuels (nom de log → blueprint), mappés par l'utilisateur pour les noms
    // que l'auto-matching ne couvre pas (renommages entre patchs, FR non traduit…).
    // AUTORITAIRES : on écrase l'entrée pour ce nom → toujours 1 seul id, jamais ambigu.
    let aliases_raw = sqlx::query("SELECT value FROM AppMeta WHERE key = 'crafting.blueprintLogAliases'")
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
        .and_then(|r| r.try_get::<String, _>("value").ok());
    if let Some(json) = aliases_raw {
        if let Ok(map) = serde_json::from_str::<HashMap<String, String>>(&json) {
            for (raw_name, bp_id) in map {
                let key = norm_match(&raw_name);
                if !key.is_empty() && !bp_id.trim().is_empty() {
                    by_name.insert(key, vec![bp_id]);
                }
            }
        }
    }

    // Déjà possédés (compte actif).
    let owned_rows = sqlx::query("SELECT blueprintId FROM UserCraftingBlueprintOwned WHERE accountId = ?")
        .bind(&account_id)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;
    let owned: std::collections::HashSet<String> = owned_rows
        .iter()
        .filter_map(|r| r.try_get::<String, _>("blueprintId").ok())
        .collect();

    let mut already_owned = 0i64;
    let mut newly_checked = 0i64;
    let mut ambiguous_skipped = 0i64;
    let mut unmatched_names: Vec<String> = Vec::new();

    for name in &detected {
        match by_name.get(&norm_match(name)) {
            None => unmatched_names.push(name.clone()),
            Some(ids) if ids.len() > 1 => ambiguous_skipped += 1,
            Some(ids) => {
                let id = &ids[0];
                if owned.contains(id) {
                    already_owned += 1;
                } else {
                    // ADD-ONLY : INSERT OR IGNORE (jamais de décochage).
                    sqlx::query(
                        "INSERT OR IGNORE INTO UserCraftingBlueprintOwned (accountId, blueprintId, createdAt)
                         VALUES (?, ?, datetime('now'))",
                    )
                    .bind(&account_id)
                    .bind(id)
                    .execute(pool)
                    .await
                    .map_err(|e| e.to_string())?;
                    newly_checked += 1;
                }
            }
        }
    }

    Ok(json!({
        "logFound": true,
        "detected": detected.len(),
        "alreadyOwned": already_owned,
        "newlyChecked": newly_checked,
        "ambiguousSkipped": ambiguous_skipped,
        "unmatched": unmatched_names.len(),
        "unmatchedNames": unmatched_names,
    }))
}
