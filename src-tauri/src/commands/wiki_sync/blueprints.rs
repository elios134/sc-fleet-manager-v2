// Synchro Wiki des plans de fabrication (/blueprints) : plans, aspects, liens missions.
use super::*;

/* ════════════════════════  Crafting Hub (/blueprints)  ═════════════════════ */

// Plafond d'appels DÉTAIL en phase 2 (liens missions). 0 = illimité.
// Seuls les blueprints avec unlocking_missions_count > 0 déclenchent un appel détail,
// ce qui élague déjà fortement le volume (priorisation, cf. sync_components).
// Pour un test rapide : MAX_BLUEPRINT_DETAIL_FETCH = Some(20).
pub(crate) const MAX_BLUEPRINT_DETAIL_FETCH: Option<usize> = None;

/// Upsert d'une recette (LISTE /blueprints) → CraftingBlueprint + ingrédients.
/// Les liens missions (unlocking_missions) sont traités en phase 2 (détail). Best-effort.
pub(crate) async fn upsert_blueprint(app: &AppHandle, b: &Value) -> Result<bool, String> {
    let Some(id) = vstr(b, "uuid") else {
        return Ok(false);
    };
    // recordName : NOT NULL UNIQUE → key API, repli sur l'uuid.
    let record_name = vstr(b, "key").unwrap_or_else(|| id.clone());
    let output_name =
        vstr(b, "output_name").or_else(|| b.get("output").and_then(|o| vstr(o, "name")));
    // producedItemEntityClass : NOT NULL → output_class (servira d'icône au Lot 3), sinon "".
    let entity_class = vstr(b, "output_class")
        .or_else(|| b.get("output").and_then(|o| vstr(o, "class")))
        .unwrap_or_default();
    // category : placeholder simple depuis output.type (mapping FR propre au Lot 3).
    let category = b
        .get("output")
        .and_then(|o| vstr(o, "type"))
        .unwrap_or_else(|| "Autre".to_string());
    let craft_time = vi64(b, "craft_time_seconds");

    let instances = app.state::<DbInstances>();
    let lock = instances.0.read().await;
    let db = lock
        .get(DB_URL)
        .ok_or_else(|| format!("Base de données non chargée : {DB_URL}"))?;
    let pool = match db {
        DbPool::Sqlite(pool) => pool,
        #[allow(unreachable_patterns)]
        _ => return Err("Connexion SQLite attendue".into()),
    };

    sqlx::query(
        "INSERT INTO CraftingBlueprint
           (id, recordName, name, producedItemEntityClass, producedItemName,
            category, craftTimeSeconds, source, lastSyncedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'api', datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
           recordName=excluded.recordName, name=excluded.name,
           producedItemEntityClass=excluded.producedItemEntityClass,
           producedItemName=excluded.producedItemName, category=excluded.category,
           craftTimeSeconds=excluded.craftTimeSeconds, source='api',
           lastSyncedAt=datetime('now')",
    )
    .bind(&id)
    .bind(&record_name)
    .bind(output_name.clone())
    .bind(&entity_class)
    .bind(output_name)
    .bind(&category)
    .bind(craft_time)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    // Ingrédients : clear-then-recreate par blueprint, slot unique 'Recette' (écart #2).
    sqlx::query("DELETE FROM CraftingBlueprintIngredient WHERE blueprintId = ?")
        .bind(&id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    if let Some(arr) = b.get("ingredients").and_then(|a| a.as_array()) {
        for (idx, ing) in arr.iter().enumerate() {
            let kind = vstr(ing, "kind").unwrap_or_else(|| "item".to_string());
            let ing_ref = vstr(ing, "item_uuid")
                .or_else(|| vstr(ing, "resource_type_uuid"))
                .unwrap_or_default();
            let ing_name = vstr(ing, "name");
            // resource → quantity_scu (SCU) ; item → quantity (compte). Repli croisé.
            let quantity = if kind == "resource" {
                vf64(ing, "quantity_scu").or_else(|| vf64(ing, "quantity"))
            } else {
                vf64(ing, "quantity").or_else(|| vf64(ing, "quantity_scu"))
            }
            .unwrap_or(0.0);
            sqlx::query(
                "INSERT INTO CraftingBlueprintIngredient
                   (blueprintId, slotName, ingredientType, ingredientRef, ingredientName, quantity, \"order\")
                 VALUES (?, 'Recette', ?, ?, ?, ?, ?)",
            )
            .bind(&id)
            .bind(&kind)
            .bind(&ing_ref)
            .bind(ing_name)
            .bind(quantity)
            .bind(idx as i64)
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;
        }
    }

    Ok(true)
}

/// Phase 2 : à partir du DÉTAIL d'un blueprint, recrée les liens MissionBlueprintReward.
/// Parse l'uuid mission depuis web_url (…/missions/{uuid}) ; SKIP proprement si la mission
/// n'est pas en base (pas de FK cassée). Renvoie (liens créés, liens ignorés).
pub(crate) async fn link_blueprint_missions(
    app: &AppHandle,
    blueprint_id: &str,
    detail: &Value,
) -> Result<(i64, i64), String> {
    let instances = app.state::<DbInstances>();
    let lock = instances.0.read().await;
    let db = lock
        .get(DB_URL)
        .ok_or_else(|| format!("Base de données non chargée : {DB_URL}"))?;
    let pool = match db {
        DbPool::Sqlite(pool) => pool,
        #[allow(unreachable_patterns)]
        _ => return Err("Connexion SQLite attendue".into()),
    };

    // clear-then-recreate par blueprint.
    sqlx::query("DELETE FROM MissionBlueprintReward WHERE blueprintId = ?")
        .bind(blueprint_id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    let mut created = 0i64;
    let mut skipped = 0i64;

    if let Some(arr) = detail.get("unlocking_missions").and_then(|a| a.as_array()) {
        for um in arr {
            // uuid = dernier segment de web_url.
            let mission_uuid = vstr(um, "web_url")
                .and_then(|u| u.rsplit('/').next().map(|s| s.to_string()))
                .filter(|s| !s.is_empty());
            let Some(mission_uuid) = mission_uuid else {
                skipped += 1;
                continue;
            };
            // La mission doit exister en base, sinon SKIP (FK Mission(uuid)).
            let exists = sqlx::query("SELECT 1 FROM Mission WHERE uuid = ?")
                .bind(&mission_uuid)
                .fetch_optional(pool)
                .await
                .map_err(|e| e.to_string())?
                .is_some();
            if !exists {
                skipped += 1;
                continue;
            }
            let weight = vf64(um, "chance").unwrap_or(1.0);
            sqlx::query(
                "INSERT OR IGNORE INTO MissionBlueprintReward
                   (missionUuid, blueprintId, weight, poolRef)
                 VALUES (?, ?, ?, NULL)",
            )
            .bind(&mission_uuid)
            .bind(blueprint_id)
            .bind(weight)
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;
            created += 1;
        }
    }

    Ok((created, skipped))
}

/// Phase détail : remplace les ingrédients « à plat » d'un blueprint par ses EMPLACEMENTS
/// (champ `aspects` du DÉTAIL wiki). Chaque aspect = un slot (key/name) + un `input`
/// (l'ingrédient) + données du simulateur (qualité, modifiers). Renvoie le nombre de slots
/// écrits ; 0 = pas d'aspects exploitables → on conserve les ingrédients à plat (repli).
pub(crate) async fn upsert_blueprint_aspects(
    app: &AppHandle,
    blueprint_id: &str,
    detail: &Value,
) -> Result<i64, String> {
    // `aspects` est soit { aspects: [...] }, soit directement [...].
    let aspects = detail.get("aspects").and_then(|a| {
        a.get("aspects")
            .and_then(|x| x.as_array())
            .or_else(|| a.as_array())
    });
    let Some(aspects) = aspects else {
        return Ok(0);
    };
    if aspects.is_empty() {
        return Ok(0);
    }

    // Ne garder que les aspects ayant un `input` (l'ingrédient). Si aucun → on ne touche pas
    // aux ingrédients à plat existants (repli propre).
    let usable: Vec<(usize, &Value, &Value)> = aspects
        .iter()
        .enumerate()
        .filter_map(|(i, a)| a.get("input").map(|inp| (i, a, inp)))
        .collect();
    if usable.is_empty() {
        return Ok(0);
    }

    let instances = app.state::<DbInstances>();
    let lock = instances.0.read().await;
    let db = lock
        .get(DB_URL)
        .ok_or_else(|| format!("Base de données non chargée : {DB_URL}"))?;
    let pool = match db {
        DbPool::Sqlite(pool) => pool,
        #[allow(unreachable_patterns)]
        _ => return Err("Connexion SQLite attendue".into()),
    };

    // Remplace les ingrédients « à plat » par les emplacements réels.
    sqlx::query("DELETE FROM CraftingBlueprintIngredient WHERE blueprintId = ?")
        .bind(blueprint_id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    let mut written = 0i64;
    for (idx, asp, input) in usable {
        let kind = vstr(input, "kind").unwrap_or_else(|| "item".to_string());
        let ing_ref = vstr(input, "uuid").unwrap_or_default();
        let ing_name = vstr(input, "name");
        let quantity = vf64(input, "quantity_scu")
            .or_else(|| vf64(input, "quantity"))
            .unwrap_or(0.0);
        // slotName = key, nettoyé (« STOCK: » → « STOCK »). slotLabel = name lisible.
        let slot_name = vstr(asp, "key")
            .map(|k| k.trim().trim_end_matches(':').trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "Recette".to_string());
        let slot_label = vstr(asp, "name");
        let required_count = vi64(asp, "required_count");
        let selection_group = vstr(asp, "selection_group");
        let min_quality = vi64(input, "min_quality");
        let slider_min = vi64(asp, "slider_min");
        let slider_max = vi64(asp, "slider_max");
        let initial_quality = vi64(asp, "initial_quality");
        // modifiers : tableau brut conservé en JSON (label, better_when, quality_range,
        // modifier_range, value_range_type…) pour le simulateur de qualité (Lot 2).
        let modifiers_json = asp
            .get("modifiers")
            .filter(|m| !m.is_null())
            .map(|m| m.to_string());

        sqlx::query(
            "INSERT INTO CraftingBlueprintIngredient
               (blueprintId, slotName, slotLabel, ingredientType, ingredientRef, ingredientName,
                quantity, requiredCount, selectionGroup, minQuality, sliderMin, sliderMax,
                initialQuality, modifiersJson, \"order\")
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(blueprint_id)
        .bind(&slot_name)
        .bind(slot_label)
        .bind(&kind)
        .bind(&ing_ref)
        .bind(ing_name)
        .bind(quantity)
        .bind(required_count)
        .bind(selection_group)
        .bind(min_quality)
        .bind(slider_min)
        .bind(slider_max)
        .bind(initial_quality)
        .bind(modifiers_json)
        .bind(idx as i64)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
        written += 1;
    }

    Ok(written)
}

/// Phase détail : persiste les métadonnées de l'objet produit (grade, size, manufacturer,
/// itemType, subType depuis /items/{output_uuid}) + webUrl (depuis le détail blueprint).
/// Évite les appels API live à l'ouverture de la fiche (R0). UN appel /items en plus par
/// blueprint. Best-effort : webUrl est toujours posé même si /items échoue.
pub(crate) async fn upsert_blueprint_meta(
    app: &AppHandle,
    client: &reqwest::Client,
    blueprint_id: &str,
    detail: &Value,
) -> Result<bool, String> {
    let web_url = vstr(detail, "web_url");
    let output_uuid = vstr(detail, "output_item_uuid")
        .or_else(|| detail.get("output").and_then(|o| vstr(o, "uuid")));

    let mut grade: Option<String> = None;
    let mut size: Option<i64> = None;
    let mut manufacturer: Option<String> = None;
    let mut item_type: Option<String> = None;
    let mut sub_type: Option<String> = None;
    // « Description Data » (liste {name, value} déjà formatée), sérialisée telle quelle.
    let mut description_data_json: Option<String> = None;
    // Vignette de l'objet produit (images[0]) — même source que Item.imageUrl (catalog.rs).
    let mut image_url: Option<String> = None;

    if let Some(uuid) = output_uuid {
        // Petite pause avant l'appel /items (politesse API, en plus du backoff interne).
        tokio::time::sleep(Duration::from_millis(RATE_LIMIT_DELAY_MS)).await;
        if let Ok(item_resp) = fetch_with_retry(client, &format!("{WIKI_BASE}/items/{uuid}")).await
        {
            let it = item_resp.get("data").unwrap_or(&item_resp);
            grade = vstr(it, "grade");
            size = vi64(it, "size");
            manufacturer = it
                .get("manufacturer")
                .and_then(|m| vstr(m, "name"))
                .filter(|s| s != "Unknown");
            item_type = vstr(it, "type_label");
            sub_type = vstr(it, "sub_type_label");
            description_data_json = it
                .get("description_data")
                .filter(|v| v.as_array().map(|a| !a.is_empty()).unwrap_or(false))
                .map(|v| v.to_string());
            // images[0] en string OU en objet {original_url|url} (cf. catalog.rs).
            image_url = it
                .get("images")
                .and_then(|a| a.as_array())
                .and_then(|a| a.first())
                .and_then(|first| {
                    first
                        .as_str()
                        .map(|s| s.to_string())
                        .or_else(|| vstr(first, "original_url").or_else(|| vstr(first, "url")))
                });
        }
    }

    let instances = app.state::<DbInstances>();
    let lock = instances.0.read().await;
    let db = lock
        .get(DB_URL)
        .ok_or_else(|| format!("Base de données non chargée : {DB_URL}"))?;
    let pool = match db {
        DbPool::Sqlite(pool) => pool,
        #[allow(unreachable_patterns)]
        _ => return Err("Connexion SQLite attendue".into()),
    };

    sqlx::query(
        "UPDATE CraftingBlueprint
         SET grade = ?, size = ?, manufacturer = ?, itemType = ?, subType = ?, webUrl = ?,
             descriptionDataJson = ?, imageUrl = ?
         WHERE id = ?",
    )
    .bind(grade)
    .bind(size)
    .bind(manufacturer.as_deref())
    .bind(item_type)
    .bind(sub_type)
    .bind(web_url)
    .bind(description_data_json)
    .bind(image_url)
    .bind(blueprint_id)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(true)
}

#[derive(Serialize)]
#[allow(non_snake_case)]
pub struct BlueprintSyncResult {
    pub(crate) blueprintsSynced: i64,
    pub(crate) blueprintsWithSlots: i64,
    pub(crate) missionLinksCreated: i64,
    pub(crate) missionLinksSkipped: i64,
    pub(crate) errors: i64,
}
