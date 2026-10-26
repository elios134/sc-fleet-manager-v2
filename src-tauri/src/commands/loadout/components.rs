// Composants compatibles avec un emplacement (tags requis) et détail d'acquisition.

use super::*;


/* ───────────────────────── get_components_for_slot ───────────────────────── */

/// Parse une colonne scWikiRequiredTags (JSON array de strings, TEXT) → Vec<String>.
pub(crate) fn parse_tags(s: Option<String>) -> Vec<String> {
    match s {
        Some(txt) => serde_json::from_str::<Vec<String>>(&txt).unwrap_or_default(),
        None => Vec::new(),
    }
}

/// Réplique expandSlotTags V1 (tagHierarchy.ts) : ajoute les parents de tags connus pour
/// que les slots de vaisseaux variantes matchent aussi les items du vaisseau parent.
pub(crate) fn expand_slot_tags(tags: &[String]) -> Vec<String> {
    let mut out = tags.to_vec();
    for t in tags {
        if t == "ANVL_Hornet_F7A_Mk2" {
            out.push("ANVL_Hornet_Mk2".to_string());
        }
    }
    out
}

/// Réplique component:getCompatible V1 : composants compatibles d'un slot identifié par
/// (shipDataId, portName). Filtrage fidèle — type, taille (WEAPON: 1..=max ; autres:
/// min..=max), subType, puis famille de required_tags (source = composant STOCK du slot).
#[tauri::command]
pub async fn get_components_for_slot(
    ship_data_id: i64,
    port_name: String,
    hardpoint_id: Option<i64>,
    db_instances: State<'_, DbInstances>,
) -> Result<Vec<Value>, String> {
    let instances = db_instances.0.read().await;
    let pool = sqlite_pool!(instances);

    // 1. Hardpoint du slot. On cible le hardpoint EXACT par id quand il est fourni : le
    //    portName n'est PAS unique (plusieurs slots le partagent, avec parfois des tailles
    //    ou sous-types différents — ex. Idris class_2 en S4 ET S5). Repli legacy : la
    //    représentante au plus grand maxSize du portName (anciens profils sans hardpointId).
    let rep = match hardpoint_id {
        Some(hpid) => sqlx::query(
            "SELECT type, subType, minSize, maxSize, defaultComponentClassName
             FROM ShipHardpoint WHERE id = ? AND shipId = ?",
        )
        .bind(hpid)
        .bind(ship_data_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?,
        None => None,
    };
    let rep = match rep {
        Some(r) => r,
        None => {
            let hp_rows = sqlx::query(
                "SELECT type, subType, minSize, maxSize, defaultComponentClassName
                 FROM ShipHardpoint WHERE shipId = ? AND portName = ?",
            )
            .bind(ship_data_id)
            .bind(&port_name)
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?;
            match hp_rows
                .into_iter()
                .max_by_key(|r| r.try_get::<i64, _>("maxSize").unwrap_or(0))
            {
                Some(r) => r,
                None => return Ok(Vec::new()), // slot introuvable → aucun composant compatible
            }
        }
    };
    let slot_type: String = rep.try_get::<Option<String>, _>("type").ok().flatten().unwrap_or_default();
    let min_size: i64 = rep.try_get::<i64, _>("minSize").unwrap_or(1);
    let max_size: i64 = rep.try_get::<i64, _>("maxSize").unwrap_or(1);
    let sub_type: Option<String> = rep.try_get::<Option<String>, _>("subType").ok().flatten();
    let default_cn: Option<String> = rep
        .try_get::<Option<String>, _>("defaultComponentClassName")
        .ok()
        .flatten();

    // 2. Type + taille (+ subType si présent). La taille est bornée à [minSize, maxSize]
    //    du hardpoint EXACT — comme erkul : un slot S3 (ex. Varipuck S3) n'accepte que des
    //    armes S3. Les bases de tourelle ont minSize=1 → leur plage reste ouverte ; seuls
    //    les slots à taille fixe (minSize=maxSize) sont resserrés à leur taille exacte.
    let (size_lo, size_hi) = (min_size, max_size);

    // Colonnes supplémentaires (AFFICHAGE uniquement, Lot 4) : stats clés par type du
    // picker + missiles via LEFT JOIN. Le FILTRAGE (type/taille/subType/tags) est inchangé.
    let mut sql = String::from(
        "SELECT c.className, c.name, c.manufacturer, c.type, c.size, c.grade, c.class,
                c.dps, c.shieldHp, c.powerDraw, c.alphaDamage, c.shieldRegenRate, c.shieldDelayDmg,
                c.powerOutput, c.qtDriveSpeed, c.weaponFireRate, c.range, c.emMax, c.heatGen,
                c.qtSpoolTime, c.qtFuelRate, c.scWikiType, c.scWikiRequiredTags,
                ms.damage AS missileDamage, ms.lockTime AS missileLockTime,
                ms.speed AS missileSpeed, ms.lockRangeMax AS missileLockRangeMax,
                -- Acquisition (Lot 5) : achetable (UEX) + craftable (blueprint). Détails pour
                -- les tooltips : prix mini + terminal le moins cher, temps de craft + nb ingrédients.
                (CASE WHEN EXISTS(SELECT 1 FROM ItemPrice p
                     WHERE p.priceBuy > 0 AND (p.itemUuid = c.wikiId OR p.itemName = c.name))
                   THEN 1 ELSE 0 END) AS buyable,
                (SELECT MIN(p.priceBuy) FROM ItemPrice p
                   WHERE p.priceBuy > 0 AND (p.itemUuid = c.wikiId OR p.itemName = c.name)) AS buyPrice,
                (SELECT p.terminalName FROM ItemPrice p
                   WHERE p.priceBuy > 0 AND (p.itemUuid = c.wikiId OR p.itemName = c.name)
                   ORDER BY p.priceBuy ASC LIMIT 1) AS buyTerminal,
                (CASE WHEN EXISTS(SELECT 1 FROM CraftingBlueprint b
                     WHERE LOWER(b.producedItemEntityClass) = LOWER(c.className) OR b.producedItemName = c.name)
                   THEN 1 ELSE 0 END) AS craftable,
                (SELECT b.craftTimeSeconds FROM CraftingBlueprint b
                   WHERE LOWER(b.producedItemEntityClass) = LOWER(c.className) OR b.producedItemName = c.name
                   LIMIT 1) AS craftTime,
                (SELECT COUNT(*) FROM CraftingBlueprintIngredient i WHERE i.blueprintId =
                   (SELECT b.id FROM CraftingBlueprint b
                      WHERE LOWER(b.producedItemEntityClass) = LOWER(c.className) OR b.producedItemName = c.name
                      LIMIT 1)) AS craftIngredients,
                -- Stock vaisseau : vaisseau(x) sur lesquels ce composant est monté d'origine
                -- (obtenable en achetant le vaisseau, même s'il n'est ni vendu seul ni craftable).
                (SELECT GROUP_CONCAT(DISTINCT sd.name) FROM ShipHardpoint sh
                   JOIN ShipData sd ON sd.id = sh.shipId
                   WHERE sh.defaultComponentClassName = c.className) AS stockShips
         FROM Component c
         LEFT JOIN MissileStats ms ON ms.componentId = c.id
         WHERE c.type = ? AND c.size >= ? AND c.size <= ?",
    );
    if sub_type.is_some() {
        sql.push_str(" AND c.scWikiSubType = ?");
    }
    sql.push_str(" ORDER BY c.size ASC, c.grade DESC, c.name ASC");

    let mut q = sqlx::query(&sql).bind(&slot_type).bind(size_lo).bind(size_hi);
    if let Some(ref st) = sub_type {
        q = q.bind(st);
    }
    let comp_rows = q.fetch_all(pool).await.map_err(|e| e.to_string())?;

    // 3. Filtrage par famille de required_tags (réplique V1). Source = tags du composant
    //    STOCK du slot (defaultComponentClassName). Si stock absent de la base → pas de
    //    filtre. Tags du slot non vides → intersection (≥1 tag commun, après expansion).
    //    Tags du slot vides → on ne garde que les composants génériques (tags vides).
    let mut apply_tag_filter = false;
    let mut generic_only = false;
    let mut expanded: Vec<String> = Vec::new();
    if let Some(cn) = &default_cn {
        let stock = sqlx::query("SELECT scWikiRequiredTags FROM Component WHERE className = ?")
            .bind(cn)
            .fetch_optional(pool)
            .await
            .map_err(|e| e.to_string())?;
        if let Some(srow) = stock {
            apply_tag_filter = true;
            let slot_tags = parse_tags(srow.try_get::<Option<String>, _>("scWikiRequiredTags").ok().flatten());
            if slot_tags.is_empty() {
                generic_only = true;
            } else {
                expanded = expand_slot_tags(&slot_tags);
            }
        }
        // stock introuvable → apply_tag_filter reste false (pas de filtre), comme V1.
    }

    // 4. Sortie filtrée.
    let mut out: Vec<Value> = Vec::with_capacity(comp_rows.len());
    for r in &comp_rows {
        if apply_tag_filter {
            let item_tags = parse_tags(r.try_get::<Option<String>, _>("scWikiRequiredTags").ok().flatten());
            let keep = if generic_only {
                item_tags.is_empty()
            } else {
                expanded.iter().any(|t| item_tags.contains(t))
            };
            if !keep {
                continue;
            }
        }
        out.push(row_to_json(r));
    }

    Ok(out)
}

/* ───────────────────────── get_acquisition_detail ────────────────────────── */

/// Détail d'acquisition d'un composant (pour la mini-modale du picker) : lieux d'achat
/// (terminal + prix), recette de craft (blueprintId + temps + ingrédients), vaisseaux dont
/// il est le stock d'origine. Appelée au clic sur une icône 🛒/🔧/📦.
#[tauri::command]
pub async fn get_acquisition_detail(
    class_name: String,
    name: String,
    db_instances: State<'_, DbInstances>,
) -> Result<Value, String> {
    let instances = db_instances.0.read().await;
    let pool = sqlite_pool!(instances);

    // wikiId (uuid) résolu depuis le composant pour matcher ItemPrice par uuid OU par nom.
    let wiki_id: Option<String> = sqlx::query("SELECT wikiId FROM Component WHERE className = ?")
        .bind(&class_name)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?
        .and_then(|r| r.try_get::<Option<String>, _>("wikiId").ok().flatten());

    // 1. Achat : tous les terminaux qui vendent l'item, du moins cher au plus cher.
    let buy_rows = sqlx::query(
        "SELECT terminalName, priceBuy FROM ItemPrice
         WHERE priceBuy > 0 AND (itemUuid = ? OR itemName = ?)
         ORDER BY priceBuy ASC LIMIT 60",
    )
    .bind(&wiki_id)
    .bind(&name)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;
    let buy: Vec<Value> = buy_rows
        .iter()
        .map(|r| {
            json!({
                "terminal": r.try_get::<Option<String>, _>("terminalName").ok().flatten(),
                "price": r.try_get::<Option<f64>, _>("priceBuy").ok().flatten(),
            })
        })
        .collect();

    // 2. Craft : recette (insensible à la casse sur la classe, sinon par nom) + ingrédients.
    let bp = sqlx::query(
        "SELECT id, craftTimeSeconds FROM CraftingBlueprint
         WHERE LOWER(producedItemEntityClass) = LOWER(?) OR producedItemName = ?
         LIMIT 1",
    )
    .bind(&class_name)
    .bind(&name)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;
    let craft = if let Some(b) = bp {
        // id de blueprint = UUID TEXT (pas un entier) → lecture en String.
        let bp_id: String = b.try_get("id").unwrap_or_default();
        let ing_rows = sqlx::query(
            "SELECT ingredientName, quantity FROM CraftingBlueprintIngredient
             WHERE blueprintId = ? ORDER BY \"order\" ASC",
        )
        .bind(&bp_id)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;
        let ingredients: Vec<Value> = ing_rows
            .iter()
            .map(|r| {
                json!({
                    "name": r.try_get::<Option<String>, _>("ingredientName").ok().flatten(),
                    "qty": r.try_get::<Option<f64>, _>("quantity").ok().flatten(),
                })
            })
            .collect();
        json!({
            "blueprintId": bp_id,
            "timeSeconds": b.try_get::<Option<i64>, _>("craftTimeSeconds").ok().flatten(),
            "ingredients": ingredients,
        })
    } else {
        Value::Null
    };

    // 3. Stock vaisseau : vaisseaux où le composant est monté d'origine.
    let ship_rows = sqlx::query(
        "SELECT DISTINCT sd.name FROM ShipHardpoint sh
         JOIN ShipData sd ON sd.id = sh.shipId
         WHERE sh.defaultComponentClassName = ? ORDER BY sd.name ASC",
    )
    .bind(&class_name)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;
    let ships: Vec<Value> = ship_rows
        .iter()
        .map(|r| json!(r.try_get::<Option<String>, _>("name").ok().flatten()))
        .collect();

    Ok(json!({ "buy": buy, "craft": craft, "ships": ships }))
}
