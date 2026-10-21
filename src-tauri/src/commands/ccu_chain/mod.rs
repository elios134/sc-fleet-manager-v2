use serde::Serialize;
use serde_json::{json, Value};
use sqlx::Row;
use std::collections::{HashMap, HashSet};
use std::time::Duration;
use tauri::State;
use tauri_plugin_sql::{DbInstances, DbPool};

use crate::DB_URL;

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

    let last_online_sync_at = sqlx::query("SELECT value FROM AppMeta WHERE key = 'ccu.lastOnlineSyncAt'")
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?
        .and_then(|r| r.try_get::<String, _>("value").ok());

    Ok(json!({
        "hasSkus": skus > 0,
        "hasUpgrades": upgrades > 0,
        "lastSyncAt": last_sync_at,
        "lastOnlineSyncAt": last_online_sync_at,
    }))
}

/* ──────────────────────── get_ccu_ships_metadata ────────────────────────── */

/// Tokens marquant un nom ShipData comme variante cosmétique/événement (pas le
/// chassis de base). Permet de garder le vaisseau de base comme nom canonique.
const VARIANT_NAME_TOKENS: [&str; 9] = [
    "wikelo", "pyam", "exec", "bis", "special", "edition", "color", "snowblind", "snowland",
];

fn is_variant_name(name: &str) -> bool {
    let lower = name.to_lowercase();
    VARIANT_NAME_TOKENS.iter().any(|t| lower.contains(t))
}

/// Métadonnées de TOUS les chassis du graphe CCU — UNION des cibles achetables
/// (CcuSku.shipId) ET des sources d'upgrade (CcuUpgrade.fromShipId, souvent sans SKU).
/// Hydraté depuis ShipData (rsiShipId) ; repli RsiShipName puis « Ship #<id> ». Prix =
/// SKU le moins cher, sinon MSRP. Dédup canonique (vaisseau de base > variantes).
#[tauri::command]
pub async fn get_ccu_ships_metadata(
    account_id: String,
    db_instances: State<'_, DbInstances>,
) -> Result<Vec<Value>, String> {
    let instances = db_instances.0.read().await;
    let pool = sqlite_pool!(instances);

    // 1. SKUs → prix le moins cher + disponibilité par shipId (cibles achetables).
    let sku_rows = sqlx::query("SELECT shipId, priceCents, available FROM CcuSku")
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;
    let mut cheapest_by_ship: HashMap<i64, i64> = HashMap::new();
    // Prix standard (SKU le plus cher) + nombre de SKU par vaisseau : sert à savoir si le
    // prix affiché (= le moins cher) est en réalité un prix WARBOND (vaisseau multi-SKU
    // dont le moins cher < le standard), même règle que la détection warbond du moteur.
    let mut dearest_by_ship: HashMap<i64, i64> = HashMap::new();
    let mut sku_count_by_ship: HashMap<i64, i64> = HashMap::new();
    let mut available_by_ship: HashSet<i64> = HashSet::new();
    for r in &sku_rows {
        let ship_id = r.try_get::<i64, _>("shipId").map_err(|e| e.to_string())?;
        let price = r.try_get::<i64, _>("priceCents").map_err(|e| e.to_string())?;
        cheapest_by_ship
            .entry(ship_id)
            .and_modify(|c| {
                if price < *c {
                    *c = price;
                }
            })
            .or_insert(price);
        dearest_by_ship
            .entry(ship_id)
            .and_modify(|d| {
                if price > *d {
                    *d = price;
                }
            })
            .or_insert(price);
        *sku_count_by_ship.entry(ship_id).or_insert(0) += 1;
        if r.try_get::<i64, _>("available").unwrap_or(0) == 1 {
            available_by_ship.insert(ship_id);
        }
    }

    // 2. Sources d'upgrade (CcuUpgrade.fromShipId) — souvent sans CcuSku.
    let from_rows = sqlx::query("SELECT DISTINCT fromShipId FROM CcuUpgrade")
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;

    // 3. ShipData (SC Wiki) : nom/fabricant/focus/msrp/image.
    let ship_rows = sqlx::query(
        "SELECT rsiShipId, name, manufacturer, focus, msrpUsd, imageUrl
         FROM ShipData WHERE rsiShipId IS NOT NULL",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    // 4. RsiShipName (repli pour les chassis absents du SC Wiki).
    let rsi_rows = sqlx::query("SELECT shipId, name FROM RsiShipName")
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;

    // 5. Possédés (rsiShipId) du compte actif.
    let owned_rows = sqlx::query(
        "SELECT DISTINCT sd.rsiShipId FROM Ship s JOIN ShipData sd ON sd.name = s.name
         WHERE s.accountId = ? AND sd.rsiShipId IS NOT NULL",
    )
    .bind(&account_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;
    let owned_ids: HashSet<i64> = owned_rows
        .iter()
        .filter_map(|r| r.try_get::<Option<i64>, _>("rsiShipId").ok().flatten())
        .collect();

    // Union des chassis : cibles achetables + sources d'upgrade.
    let mut ship_ids: HashSet<i64> = cheapest_by_ship.keys().copied().collect();
    for r in &from_rows {
        if let Ok(id) = r.try_get::<i64, _>("fromShipId") {
            ship_ids.insert(id);
        }
    }

    // Dédup canonique : non-variante d'abord, puis nom le plus court ; first-wins.
    struct Meta {
        name: String,
        manufacturer: Option<String>,
        focus: Option<String>,
        image_url: Option<String>,
    }
    type ShipRow = (i64, String, Option<String>, Option<String>, Option<i64>, Option<String>);
    let mut rows_sorted: Vec<ShipRow> =
        ship_rows
            .iter()
            .filter_map(|r| {
                let id = r.try_get::<Option<i64>, _>("rsiShipId").ok().flatten()?;
                let name = r.try_get::<String, _>("name").ok()?;
                Some((
                    id,
                    name,
                    r.try_get::<Option<String>, _>("manufacturer").ok().flatten(),
                    r.try_get::<Option<String>, _>("focus")
                        .ok()
                        .flatten()
                        .filter(|s| !s.is_empty()),
                    r.try_get::<Option<i64>, _>("msrpUsd").ok().flatten(),
                    r.try_get::<Option<String>, _>("imageUrl").ok().flatten(),
                ))
            })
            .collect();
    rows_sorted.sort_by(|a, b| {
        let va = is_variant_name(&a.1) as i32;
        let vb = is_variant_name(&b.1) as i32;
        va.cmp(&vb).then_with(|| a.1.len().cmp(&b.1.len()))
    });
    let mut meta_by_id: HashMap<i64, Meta> = HashMap::new();
    let mut msrp_by_id: HashMap<i64, i64> = HashMap::new();
    for (id, name, manufacturer, focus, msrp, image_url) in rows_sorted {
        meta_by_id.entry(id).or_insert(Meta {
            name,
            manufacturer,
            focus,
            image_url,
        });
        if let Some(m) = msrp {
            msrp_by_id.entry(id).or_insert(m * 100);
        }
    }

    let mut rsi_name_by_id: HashMap<i64, String> = HashMap::new();
    for r in &rsi_rows {
        if let (Ok(id), Ok(name)) = (
            r.try_get::<i64, _>("shipId"),
            r.try_get::<String, _>("name"),
        ) {
            rsi_name_by_id.insert(id, name);
        }
    }

    let mut out: Vec<Value> = Vec::with_capacity(ship_ids.len());
    for ship_id in ship_ids {
        let meta = meta_by_id.get(&ship_id);
        let name = meta
            .map(|m| m.name.clone())
            .or_else(|| rsi_name_by_id.get(&ship_id).cloned())
            .unwrap_or_else(|| format!("Ship #{ship_id}"));
        // Prix : CcuSku le moins cher, sinon MSRP (déjà en cents), sinon null.
        let ccu_price = cheapest_by_ship.get(&ship_id).copied();
        let msrp_price = msrp_by_id.get(&ship_id).copied();
        let (price_cents, price_source): (Option<i64>, Option<&str>) = match ccu_price {
            Some(c) => (Some(c), Some("ccu")),
            None => match msrp_price {
                Some(m) => (Some(m), Some("msrp")),
                None => (None, None),
            },
        };
        // Le prix affiché (= le moins cher) est-il un prix warbond ? Uniquement pour les
        // prix d'origine CCU multi-SKU : standard = SKU le plus cher.
        let dearest = dearest_by_ship.get(&ship_id).copied();
        let sku_count = sku_count_by_ship.get(&ship_id).copied().unwrap_or(0);
        let is_warbond_price = price_source == Some("ccu")
            && sku_count >= 2
            && matches!((ccu_price, dearest), (Some(c), Some(d)) if c < d);
        let standard_price_cents = if is_warbond_price { dearest } else { None };
        out.push(json!({
            "shipId": ship_id,
            "name": name,
            "manufacturer": meta.and_then(|m| m.manufacturer.clone()),
            "focus": meta.and_then(|m| m.focus.clone()),
            "imageUrl": meta.and_then(|m| m.image_url.clone()),
            "priceCents": price_cents,
            "priceSource": price_source,
            "isWarbondPrice": is_warbond_price,
            "standardPriceCents": standard_price_cents,
            "isOwned": owned_ids.contains(&ship_id),
            "isAvailable": available_by_ship.contains(&ship_id),
        }));
    }
    out.sort_by(|a, b| {
        a["name"]
            .as_str()
            .unwrap_or("")
            .to_lowercase()
            .cmp(&b["name"].as_str().unwrap_or("").to_lowercase())
    });
    Ok(out)
}

// Sous-modules (déclarés après les macros locales, visibles par portée textuelle).
pub(crate) mod index_sync;
pub(crate) mod paths;
