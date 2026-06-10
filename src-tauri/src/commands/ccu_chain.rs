use serde::Serialize;
use serde_json::{json, Value};
use sqlx::Row;
use std::collections::{HashMap, HashSet};
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

/* ───────────────────────── get_ccu_catalog_status ───────────────────────── */

#[tauri::command]
#[allow(unused_variables)]
pub async fn get_ccu_catalog_status(
    account_id: String,
    db_instances: State<'_, DbInstances>,
) -> Result<Value, String> {
    let instances = db_instances.0.read().await;
    let pool = sqlite_pool!(instances);

    let skus = sqlx::query("SELECT COUNT(*) as count FROM CcuSku")
        .fetch_one(pool)
        .await
        .map_err(|e| e.to_string())?
        .try_get::<i64, _>("count")
        .map_err(|e| e.to_string())?;

    let upgrades = sqlx::query("SELECT COUNT(*) as count FROM CcuUpgrade")
        .fetch_one(pool)
        .await
        .map_err(|e| e.to_string())?
        .try_get::<i64, _>("count")
        .map_err(|e| e.to_string())?;

    let last_sync_at = sqlx::query("SELECT value FROM AppMeta WHERE key = 'ccu.lastSyncAt'")
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?
        .and_then(|r| r.try_get::<String, _>("value").ok());

    Ok(json!({
        "hasSkus": skus > 0,
        "hasUpgrades": upgrades > 0,
        "lastSyncAt": last_sync_at,
    }))
}

/* ──────────────────────── get_ccu_ships_metadata ────────────────────────── */

#[tauri::command]
pub async fn get_ccu_ships_metadata(
    account_id: String,
    db_instances: State<'_, DbInstances>,
) -> Result<Vec<Value>, String> {
    let instances = db_instances.0.read().await;
    let pool = sqlite_pool!(instances);

    // Vaisseaux possédés (par nom) du compte actif → pour isOwned.
    let owned_rows = sqlx::query("SELECT DISTINCT s.name FROM Ship s WHERE s.accountId = ?")
        .bind(&account_id)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;
    let owned_names: HashSet<String> = owned_rows
        .iter()
        .filter_map(|r| r.try_get::<String, _>("name").ok())
        .collect();

    let rows = sqlx::query(
        "SELECT
           sd.rsiShipId as shipId,
           sd.name,
           sd.manufacturer,
           sd.focus,
           sd.imageUrl,
           sd.msrpUsd,
           MIN(cs.priceCents) as cheapestPriceCents,
           CASE WHEN SUM(CASE WHEN cs.available = 1 THEN 1 ELSE 0 END) > 0 THEN 1 ELSE 0 END as isAvailable
         FROM ShipData sd
         LEFT JOIN CcuSku cs ON cs.shipId = sd.rsiShipId
         WHERE sd.rsiShipId IS NOT NULL
         GROUP BY sd.rsiShipId, sd.name, sd.manufacturer, sd.focus, sd.imageUrl, sd.msrpUsd",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut out = Vec::with_capacity(rows.len());
    for row in &rows {
        let ship_id = row.try_get::<i64, _>("shipId").map_err(|e| e.to_string())?;
        let name = row.try_get::<String, _>("name").map_err(|e| e.to_string())?;
        let manufacturer = row.try_get::<Option<String>, _>("manufacturer").ok().flatten();
        let focus = row
            .try_get::<Option<String>, _>("focus")
            .ok()
            .flatten()
            .filter(|s| !s.is_empty());
        let image_url = row.try_get::<Option<String>, _>("imageUrl").ok().flatten();
        let msrp_usd = row.try_get::<Option<i64>, _>("msrpUsd").ok().flatten();
        let cheapest = row.try_get::<Option<i64>, _>("cheapestPriceCents").ok().flatten();
        let is_available = row.try_get::<i64, _>("isAvailable").unwrap_or(0) == 1;

        // priceCents : CcuSku le moins cher, sinon msrpUsd*100, sinon null.
        let (price_cents, price_source): (Option<i64>, Option<&str>) = match cheapest {
            Some(c) => (Some(c), Some("ccu")),
            None => match msrp_usd {
                Some(m) => (Some(m * 100), Some("msrp")),
                None => (None, None),
            },
        };

        out.push(json!({
            "shipId": ship_id,
            "name": name,
            "manufacturer": manufacturer,
            "focus": focus,
            "imageUrl": image_url,
            "priceCents": price_cents,
            "priceSource": price_source,
            "isOwned": owned_names.contains(&name),
            "isAvailable": is_available,
        }));
    }

    Ok(out)
}

/* ─────────────────────────────  find_ccu_paths  ──────────────────────────── */

struct Edge {
    to_ship_id: i64,
    to_sku_id: i64,
    upgrade_price_cents: i64,
    sku_price_cents: i64,
}

#[derive(Clone, Serialize)]
struct StepData {
    #[serde(rename = "fromShipId")]
    from_ship_id: i64,
    #[serde(rename = "toShipId")]
    to_ship_id: i64,
    #[serde(rename = "toSkuId")]
    to_sku_id: i64,
    #[serde(rename = "toSkuPriceCents")]
    to_sku_price_cents: i64,
    #[serde(rename = "upgradePriceCents")]
    upgrade_price_cents: i64,
}

struct Frame {
    current: i64,
    steps: Vec<StepData>,
    total_cost: i64,
    visited: HashSet<i64>,
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn find_ccu_paths(
    from_ship_id: i64,
    to_ship_id: i64,
    max_steps: Option<i64>,
    only_available: Option<bool>,
    only_owned_source: Option<bool>,
    top_n: Option<i64>,
    account_id: String,
    db_instances: State<'_, DbInstances>,
) -> Result<Value, String> {
    let only_available = only_available.unwrap_or(false);
    let only_owned_source = only_owned_source.unwrap_or(false);
    let max_steps = max_steps.unwrap_or(5).min(8).max(1);
    let top_n = top_n.unwrap_or(30).max(1) as usize;

    if from_ship_id == to_ship_id {
        return Ok(json!({
            "paths": [],
            "totalFound": 0,
            "directCostCents": Value::Null,
            "bestSavingCents": Value::Null,
            "truncated": false,
        }));
    }

    let instances = db_instances.0.read().await;
    let pool = sqlite_pool!(instances);

    // Étape A — charger le graphe en une requête.
    let graph_sql = if only_available {
        "SELECT cu.fromShipId, cs.shipId as toShipId, cu.toSkuId,
                cu.upgradePriceCents, cs.priceCents as skuPriceCents, cs.available
         FROM CcuUpgrade cu
         JOIN CcuSku cs ON cs.skuId = cu.toSkuId
         WHERE cs.available = 1"
    } else {
        "SELECT cu.fromShipId, cs.shipId as toShipId, cu.toSkuId,
                cu.upgradePriceCents, cs.priceCents as skuPriceCents, cs.available
         FROM CcuUpgrade cu
         JOIN CcuSku cs ON cs.skuId = cu.toSkuId"
    };

    let graph_rows = sqlx::query(graph_sql)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;

    let mut graph: HashMap<i64, Vec<Edge>> = HashMap::new();
    for row in &graph_rows {
        let from = row.try_get::<i64, _>("fromShipId").map_err(|e| e.to_string())?;
        let edge = Edge {
            to_ship_id: row.try_get::<i64, _>("toShipId").map_err(|e| e.to_string())?,
            to_sku_id: row.try_get::<i64, _>("toSkuId").map_err(|e| e.to_string())?,
            upgrade_price_cents: row
                .try_get::<i64, _>("upgradePriceCents")
                .map_err(|e| e.to_string())?,
            sku_price_cents: row
                .try_get::<i64, _>("skuPriceCents")
                .map_err(|e| e.to_string())?,
        };
        graph.entry(from).or_default().push(edge);
    }

    // Étape B — ships possédés (rsiShipId) si filtre only_owned_source.
    let owned_ids: HashSet<i64> = if only_owned_source {
        let rows = sqlx::query(
            "SELECT DISTINCT sd.rsiShipId
             FROM Ship s JOIN ShipData sd ON sd.name = s.name
             WHERE s.accountId = ? AND sd.rsiShipId IS NOT NULL",
        )
        .bind(&account_id)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;
        rows.iter()
            .filter_map(|r| r.try_get::<Option<i64>, _>("rsiShipId").ok().flatten())
            .collect()
    } else {
        HashSet::new()
    };

    // Étape C — DFS borné.
    let mut found: Vec<(Vec<StepData>, i64)> = Vec::new();
    let mut stack: Vec<Frame> = vec![Frame {
        current: from_ship_id,
        steps: Vec::new(),
        total_cost: 0,
        visited: HashSet::from([from_ship_id]),
    }];

    while let Some(frame) = stack.pop() {
        let Some(edges) = graph.get(&frame.current) else {
            continue;
        };
        for edge in edges {
            if frame.visited.contains(&edge.to_ship_id) {
                continue; // évite les cycles
            }
            // Filtre source possédée : seul le vaisseau de départ doit être possédé.
            if only_owned_source && frame.steps.is_empty() && !owned_ids.contains(&from_ship_id) {
                continue;
            }

            let mut new_steps = frame.steps.clone();
            new_steps.push(StepData {
                from_ship_id: frame.current,
                to_ship_id: edge.to_ship_id,
                to_sku_id: edge.to_sku_id,
                to_sku_price_cents: edge.sku_price_cents,
                upgrade_price_cents: edge.upgrade_price_cents,
            });
            let new_cost = frame.total_cost + edge.upgrade_price_cents;

            if edge.to_ship_id == to_ship_id {
                found.push((new_steps, new_cost));
            } else if new_steps.len() < max_steps as usize {
                let mut visited = frame.visited.clone();
                visited.insert(edge.to_ship_id);
                stack.push(Frame {
                    current: edge.to_ship_id,
                    steps: new_steps,
                    total_cost: new_cost,
                    visited,
                });
            }
        }
    }

    // Étape D — coût direct (arête directe la moins chère from→to).
    let direct_cost_cents: Option<i64> = graph.get(&from_ship_id).and_then(|edges| {
        edges
            .iter()
            .filter(|e| e.to_ship_id == to_ship_id)
            .map(|e| e.upgrade_price_cents)
            .min()
    });

    // Étape F — tri par coût croissant, troncature top_n.
    found.sort_by_key(|(_, cost)| *cost);
    let total_found = found.len();
    let truncated = total_found > top_n;
    found.truncate(top_n);

    // Étapes E + sérialisation.
    let paths: Vec<Value> = found
        .iter()
        .map(|(steps, total)| {
            let saving = direct_cost_cents.map(|d| d - total);
            json!({
                "steps": steps,
                "totalCostCents": total,
                "stepCount": steps.len(),
                "directCostCents": direct_cost_cents,
                "savingCents": saving,
            })
        })
        .collect();

    // La meilleure économie correspond au chemin le moins cher (premier après tri).
    let best_saving_cents: Option<i64> = found
        .first()
        .and_then(|(_, total)| direct_cost_cents.map(|d| d - total));

    Ok(json!({
        "paths": paths,
        "totalFound": total_found,
        "directCostCents": direct_cost_cents,
        "bestSavingCents": best_saving_cents,
        "truncated": truncated,
    }))
}
