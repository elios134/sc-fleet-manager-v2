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
        "SELECT s.id, s.name, s.manufacturer, s.acquisition,
                sd.id as shipDataId, sd.wikiId, sd.imageUrl, sd.imageTopDownUrl,
                sd.emSignature, sd.irSignature, sd.crossSection
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
    shield_delay_dmg: Option<f64>,
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
                    shieldRegenRate, shieldDelayDmg, powerOutput, qtDriveSpeed
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
                        shield_delay_dmg: r
                            .try_get::<Option<f64>, _>("shieldDelayDmg")
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
            "realShieldDelayDmg": stats.and_then(|s| s.shield_delay_dmg),
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

/* ───────────────────────────── get_stock_for_ship ────────────────────────── */

/// Réplique getStockForShip V1 : pour un ShipData, renvoie l'ARBRE complet de ses
/// hardpoints (racines + enfants), chaque slot PRÉ-REMPLI avec son composant par défaut
/// résolu via defaultComponentClassName → Component (par className).
///
/// Sortie : liste à plat en PRÉ-ORDRE (parent immédiatement suivi de ses enfants) avec un
/// champ `depth` (0 = racine) pour le rendu hiérarchique indenté côté front. Si un
/// defaultComponentClassName ne matche aucun Component → slot laissé vide (best-effort).
#[tauri::command]
pub async fn get_stock_for_ship(
    ship_data_id: i64,
    db_instances: State<'_, DbInstances>,
) -> Result<Vec<Value>, String> {
    let instances = db_instances.0.read().await;
    let pool = sqlite_pool!(instances);

    // 1. Tous les hardpoints du vaisseau (ordre stable comme V1 : type asc, portName asc).
    let hp_rows = sqlx::query(
        "SELECT id, portName, displayName, type, subType, minSize, maxSize,
                defaultComponentClassName, parentId
         FROM ShipHardpoint
         WHERE shipId = ?
         ORDER BY type ASC, portName ASC",
    )
    .bind(ship_data_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    // 2. Résolution batch des composants par défaut (className → Component).
    let class_names: Vec<String> = hp_rows
        .iter()
        .filter_map(|r| {
            r.try_get::<Option<String>, _>("defaultComponentClassName")
                .ok()
                .flatten()
        })
        .filter(|s| !s.is_empty())
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();

    let mut comp_by_class: HashMap<String, serde_json::Map<String, Value>> = HashMap::new();
    if !class_names.is_empty() {
        let placeholders = vec!["?"; class_names.len()].join(", ");
        let sql = format!(
            "SELECT className, name, manufacturer, size, grade,
                    dps, shieldHp, powerDraw, alphaDamage, shieldRegenRate, shieldDelayDmg, powerOutput
             FROM Component WHERE className IN ({placeholders})"
        );
        let mut q = sqlx::query(&sql);
        for cn in &class_names {
            q = q.bind(cn);
        }
        let comp_rows = q.fetch_all(pool).await.map_err(|e| e.to_string())?;
        for r in &comp_rows {
            let Ok(cn) = r.try_get::<String, _>("className") else {
                continue;
            };
            let mut m = serde_json::Map::new();
            m.insert("componentClassName".into(), json!(cn));
            m.insert("componentName".into(), json!(r.try_get::<Option<String>, _>("name").ok().flatten()));
            m.insert("componentMake".into(), json!(r.try_get::<Option<String>, _>("manufacturer").ok().flatten()));
            m.insert("componentGrade".into(), json!(r.try_get::<Option<String>, _>("grade").ok().flatten()));
            m.insert("componentSize".into(), json!(r.try_get::<Option<i64>, _>("size").ok().flatten()));
            m.insert("realDps".into(), json!(r.try_get::<Option<f64>, _>("dps").ok().flatten()));
            m.insert("realShieldHp".into(), json!(r.try_get::<Option<f64>, _>("shieldHp").ok().flatten()));
            m.insert("realPowerDraw".into(), json!(r.try_get::<Option<f64>, _>("powerDraw").ok().flatten()));
            m.insert("realAlphaDamage".into(), json!(r.try_get::<Option<f64>, _>("alphaDamage").ok().flatten()));
            m.insert("realShieldRegenRate".into(), json!(r.try_get::<Option<f64>, _>("shieldRegenRate").ok().flatten()));
            m.insert("realShieldDelayDmg".into(), json!(r.try_get::<Option<f64>, _>("shieldDelayDmg").ok().flatten()));
            m.insert("realPowerOutput".into(), json!(r.try_get::<Option<f64>, _>("powerOutput").ok().flatten()));
            comp_by_class.insert(cn, m);
        }
    }

    // Dédup (réplique la dédup V1 du picker) : un même portName peut avoir plusieurs
    // lignes (variantes de taille) → on garde la représentante au plus grand maxSize et
    // on remappe les parentId vers la représentante pour préserver la hiérarchie.
    let mut rep_by_port: HashMap<String, (i64, i64)> = HashMap::new(); // portName → (repId, maxSize)
    for r in &hp_rows {
        let id: i64 = r.try_get("id").map_err(|e| e.to_string())?;
        let port = r.try_get::<Option<String>, _>("portName").ok().flatten().unwrap_or_default();
        let ms: i64 = r.try_get::<i64, _>("maxSize").unwrap_or(0);
        rep_by_port
            .entry(port)
            .and_modify(|e| {
                if ms > e.1 {
                    *e = (id, ms);
                }
            })
            .or_insert((id, ms));
    }
    let mut id_to_rep: HashMap<i64, i64> = HashMap::new();
    for r in &hp_rows {
        let id: i64 = r.try_get("id").map_err(|e| e.to_string())?;
        let port = r.try_get::<Option<String>, _>("portName").ok().flatten().unwrap_or_default();
        if let Some((rep, _)) = rep_by_port.get(&port) {
            id_to_rep.insert(id, *rep);
        }
    }

    // 3. Construction des nœuds (slot JSON pré-rempli), représentantes seules.
    let comp_keys = [
        "componentClassName", "componentName", "componentMake", "componentGrade",
        "componentSize", "realDps", "realShieldHp", "realPowerDraw", "realAlphaDamage",
        "realShieldRegenRate", "realShieldDelayDmg", "realPowerOutput",
    ];
    let mut node_json: HashMap<i64, Value> = HashMap::new();
    let mut order: Vec<i64> = Vec::new();
    let mut parent_of: HashMap<i64, Option<i64>> = HashMap::new();
    let mut id_set: std::collections::HashSet<i64> = std::collections::HashSet::new();

    for r in &hp_rows {
        let id: i64 = r.try_get("id").map_err(|e| e.to_string())?;
        let port = r.try_get::<Option<String>, _>("portName").ok().flatten().unwrap_or_default();
        // Dédup : ignorer les doublons (on ne garde que la représentante du portName).
        if rep_by_port.get(&port).map(|(rep, _)| *rep) != Some(id) {
            continue;
        }
        // parentId remappé vers la représentante du portName parent.
        let parent_raw: Option<i64> = r.try_get::<Option<i64>, _>("parentId").ok().flatten();
        let parent: Option<i64> = parent_raw.and_then(|p| id_to_rep.get(&p).copied());
        let default_cn = r
            .try_get::<Option<String>, _>("defaultComponentClassName")
            .ok()
            .flatten();

        let mut m = serde_json::Map::new();
        m.insert("hardpointId".into(), json!(id));
        m.insert("parentId".into(), json!(parent));
        m.insert("portName".into(), json!(r.try_get::<Option<String>, _>("portName").ok().flatten()));
        m.insert("displayName".into(), json!(r.try_get::<Option<String>, _>("displayName").ok().flatten()));
        m.insert("slotType".into(), json!(r.try_get::<Option<String>, _>("type").ok().flatten()));
        m.insert("subType".into(), json!(r.try_get::<Option<String>, _>("subType").ok().flatten()));
        m.insert("minSize".into(), json!(r.try_get::<Option<i64>, _>("minSize").ok().flatten()));
        m.insert("maxSize".into(), json!(r.try_get::<Option<i64>, _>("maxSize").ok().flatten()));

        // Composant par défaut (ou champs nuls si non résolu).
        let comp = default_cn.as_ref().and_then(|cn| comp_by_class.get(cn));
        for k in comp_keys {
            let v = comp.and_then(|c| c.get(k).cloned()).unwrap_or(Value::Null);
            m.insert(k.into(), v);
        }

        node_json.insert(id, Value::Object(m));
        order.push(id);
        parent_of.insert(id, parent);
        id_set.insert(id);
    }

    // 4. Adjacence enfants (ordre de requête préservé) + racines.
    let mut children: HashMap<i64, Vec<i64>> = HashMap::new();
    let mut roots: Vec<i64> = Vec::new();
    for &id in &order {
        match parent_of.get(&id).copied().flatten() {
            Some(p) if id_set.contains(&p) => children.entry(p).or_default().push(id),
            _ => roots.push(id), // racine, ou parent orphelin → rattaché à la racine
        }
    }

    // 5. DFS pré-ordre avec depth.
    let mut out: Vec<Value> = Vec::new();
    let mut stack: Vec<(i64, i64)> = roots.iter().rev().map(|&id| (id, 0)).collect();
    while let Some((id, depth)) = stack.pop() {
        if let Some(slot) = node_json.get(&id) {
            let mut slot = slot.clone();
            if let Value::Object(ref mut m) = slot {
                m.insert("depth".into(), json!(depth));
            }
            out.push(slot);
        }
        if let Some(kids) = children.get(&id) {
            for &k in kids.iter().rev() {
                stack.push((k, depth + 1));
            }
        }
    }

    Ok(out)
}

/* ───────────────────────── get_components_for_slot ───────────────────────── */

/// Parse une colonne scWikiRequiredTags (JSON array de strings, TEXT) → Vec<String>.
fn parse_tags(s: Option<String>) -> Vec<String> {
    match s {
        Some(txt) => serde_json::from_str::<Vec<String>>(&txt).unwrap_or_default(),
        None => Vec::new(),
    }
}

/// Réplique expandSlotTags V1 (tagHierarchy.ts) : ajoute les parents de tags connus pour
/// que les slots de vaisseaux variantes matchent aussi les items du vaisseau parent.
fn expand_slot_tags(tags: &[String]) -> Vec<String> {
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
    db_instances: State<'_, DbInstances>,
) -> Result<Vec<Value>, String> {
    let instances = db_instances.0.read().await;
    let pool = sqlite_pool!(instances);

    // 1. Hardpoint(s) du slot. Un portName peut avoir plusieurs lignes (variantes de
    //    taille) : on garde la représentante au plus grand maxSize (réplique V1).
    let hp_rows = sqlx::query(
        "SELECT type, subType, minSize, maxSize, defaultComponentClassName
         FROM ShipHardpoint WHERE shipId = ? AND portName = ?",
    )
    .bind(ship_data_id)
    .bind(&port_name)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;
    if hp_rows.is_empty() {
        return Ok(Vec::new()); // slot introuvable → aucun composant compatible
    }
    let rep = hp_rows
        .iter()
        .max_by_key(|r| r.try_get::<i64, _>("maxSize").unwrap_or(0))
        .unwrap();
    let slot_type: String = rep.try_get::<Option<String>, _>("type").ok().flatten().unwrap_or_default();
    let min_size: i64 = rep.try_get::<i64, _>("minSize").unwrap_or(1);
    let max_size: i64 = rep.try_get::<i64, _>("maxSize").unwrap_or(1);
    let sub_type: Option<String> = rep.try_get::<Option<String>, _>("subType").ok().flatten();
    let default_cn: Option<String> = rep
        .try_get::<Option<String>, _>("defaultComponentClassName")
        .ok()
        .flatten();

    // 2. Type + taille (+ subType si présent). WEAPON accepte les armes plus petites.
    let (size_lo, size_hi) = if slot_type == "WEAPON" {
        (1, max_size)
    } else {
        (min_size, max_size)
    };

    // Colonnes supplémentaires (AFFICHAGE uniquement, Lot 4) : stats clés par type du
    // picker + missiles via LEFT JOIN. Le FILTRAGE (type/taille/subType/tags) est inchangé.
    let mut sql = String::from(
        "SELECT c.className, c.name, c.manufacturer, c.type, c.size, c.grade, c.class,
                c.dps, c.shieldHp, c.powerDraw, c.alphaDamage, c.shieldRegenRate, c.shieldDelayDmg,
                c.powerOutput, c.qtDriveSpeed, c.weaponFireRate, c.range, c.emMax, c.heatGen,
                c.qtSpoolTime, c.qtFuelRate, c.scWikiType, c.scWikiRequiredTags,
                ms.damage AS missileDamage, ms.lockTime AS missileLockTime,
                ms.speed AS missileSpeed, ms.lockRangeMax AS missileLockRangeMax
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

    // Défense en profondeur : un vaisseau loué a un loadout de base NON modifiable.
    let acquisition: Option<String> = sqlx::query("SELECT acquisition FROM Ship WHERE id = ?")
        .bind(ship_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?
        .and_then(|r| r.try_get::<Option<String>, _>("acquisition").ok().flatten());
    if acquisition.as_deref() == Some("rented") {
        return Err("Loadout non modifiable pour un vaisseau loué.".into());
    }

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
